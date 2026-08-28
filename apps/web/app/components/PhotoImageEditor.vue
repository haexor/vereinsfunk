<script setup lang="ts">
import {
  Check,
  Crop,
  FlipHorizontal2,
  FlipVertical2,
  Lock,
  Maximize2,
  RotateCcw,
  RotateCw,
  SlidersHorizontal,
  Sparkles,
  Unlock,
  X,
} from '@lucide/vue'
import { Cropper } from 'vue-advanced-cropper'
import {
  MAX_OUTPUT_DIMENSION,
  outputSizeError,
  readOutputDimension,
  type ImageDimensions,
} from '~/utils/imageOutputDimensions'
import 'vue-advanced-cropper/dist/style.css'

const props = defineProps<{ file: File }>()
const emit = defineEmits<{ save: [file: File]; cancel: [] }>()

type EditorTool = 'crop' | 'adjust' | 'filters' | 'resize'
type CropperController = {
  getResult: () => { canvas?: HTMLCanvasElement }
  rotate: (angle: number) => void
  flip: (horizontal: boolean, vertical: boolean) => void
  reset: () => void
}

const cropper = ref<CropperController | null>(null)
const sourceUrl = ref('')
const sourceWidth = ref(0)
const sourceHeight = ref(0)
const aspectRatio = ref<number | undefined>(undefined)
const activeTool = ref<EditorTool>('crop')
const exporting = ref(false)
const exportError = ref('')
const brightness = ref(100)
const contrast = ref(100)
const saturation = ref(100)
const selectedFilter = ref<'original' | 'mono' | 'warm' | 'cool' | 'vintage'>('original')
const outputWidth = ref(0)
const outputHeight = ref(0)
const keepAspectRatio = ref(true)

const ASPECT_RATIOS: { label: string; value: number | undefined }[] = [
  { label: 'Frei', value: undefined },
  { label: '1:1', value: 1 },
  { label: '4:5', value: 4 / 5 },
  { label: '16:9', value: 16 / 9 },
  { label: '9:16', value: 9 / 16 },
]
const TOOLS: { id: EditorTool; label: string; icon: typeof Crop }[] = [
  { id: 'crop', label: 'Zuschneiden', icon: Crop },
  { id: 'adjust', label: 'Feintuning', icon: SlidersHorizontal },
  { id: 'filters', label: 'Filter', icon: Sparkles },
  { id: 'resize', label: 'Größe', icon: Maximize2 },
]
const FILTERS: { id: typeof selectedFilter.value; label: string; className: string }[] = [
  { id: 'original', label: 'Original', className: '' },
  { id: 'mono', label: 'Schwarzweiß', className: 'grayscale(1)' },
  { id: 'warm', label: 'Warm', className: 'sepia(.28) saturate(1.12)' },
  { id: 'cool', label: 'Kühl', className: 'saturate(.82) hue-rotate(12deg)' },
  { id: 'vintage', label: 'Vintage', className: 'sepia(.48) contrast(.9) saturate(.8)' },
]

const currentFilter = computed(() => FILTERS.find((filter) => filter.id === selectedFilter.value))
const cssFilter = computed(() =>
  [
    `brightness(${brightness.value}%)`,
    `contrast(${contrast.value}%)`,
    `saturate(${saturation.value}%)`,
    currentFilter.value?.className,
  ]
    .filter(Boolean)
    .join(' '),
)
const sourceDimensions = computed(() =>
  sourceWidth.value && sourceHeight.value
    ? `${sourceWidth.value} × ${sourceHeight.value} px`
    : 'Bild wird geladen …',
)

function cropDimensions(): ImageDimensions {
  const canvas = cropper.value?.getResult().canvas
  return canvas?.width && canvas.height
    ? { width: canvas.width, height: canvas.height }
    : { width: sourceWidth.value, height: sourceHeight.value }
}

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
  const image = new Image()
  image.onload = () => {
    if (image.src !== sourceUrl.value) return
    sourceWidth.value = image.naturalWidth
    sourceHeight.value = image.naturalHeight
    outputWidth.value = 0
    outputHeight.value = 0
  }
  image.src = sourceUrl.value
}
onMounted(() => updateSourceUrl(props.file))
watch(() => props.file, updateSourceUrl)
onBeforeUnmount(() => {
  if (sourceUrl.value) URL.revokeObjectURL(sourceUrl.value)
})

function rotate(angle: number) {
  cropper.value?.rotate(angle)
}
function flip(horizontal: boolean, vertical: boolean) {
  cropper.value?.flip(horizontal, vertical)
}
function reset() {
  cropper.value?.reset()
  aspectRatio.value = undefined
  brightness.value = 100
  contrast.value = 100
  saturation.value = 100
  selectedFilter.value = 'original'
  outputWidth.value = 0
  outputHeight.value = 0
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
  const height =
    keepAspectRatio.value && dimensions.width
      ? Math.max(1, Math.round((width * dimensions.height) / dimensions.width))
      : outputHeight.value
  if (!height) return
  setOutputDimensions({ width, height })
}
function updateOutputHeight(value: string) {
  const height = readOutputDimension(value)
  if (!height) {
    exportError.value = 'Die Höhe muss eine positive Zahl sein.'
    return
  }
  const dimensions = cropDimensions()
  const width =
    keepAspectRatio.value && dimensions.height
      ? Math.max(1, Math.round((height * dimensions.width) / dimensions.height))
      : outputWidth.value
  if (!width) return
  setOutputDimensions({ width, height })
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
    context.filter = cssFilter.value
    context.drawImage(croppedCanvas, 0, 0, canvas.width, canvas.height)
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
</script>

<template>
  <div
    class="fixed inset-0 z-50 bg-[#122820]/60 p-0 sm:flex sm:items-center sm:justify-center sm:p-4"
    role="dialog"
    aria-modal="true"
    aria-labelledby="photo-editor-title"
  >
    <section
      class="flex h-full w-full flex-col overflow-hidden bg-white shadow-2xl sm:h-[min(880px,calc(100vh-2rem))] sm:max-w-6xl sm:rounded-2xl"
    >
      <header
        class="flex shrink-0 items-center justify-between gap-3 border-b border-[#e9ebe4] px-4 py-3 sm:px-6"
      >
        <div class="min-w-0">
          <h2 id="photo-editor-title" class="font-display text-base font-bold sm:text-lg">
            Bildwerkstatt
          </h2>
          <p class="hidden text-xs text-[#727a75] sm:block">
            Bearbeitungen werden vor Upload und Personenprüfung auf das Foto angewendet.
          </p>
        </div>
        <div class="hidden text-sm font-medium text-[#84909c] md:block">{{ sourceDimensions }}</div>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="focus-ring hidden rounded-lg px-3 py-2 text-xs font-semibold text-[#5c655f] hover:bg-[#f4f6f2] sm:block"
            @click="reset"
          >
            Alles zurücksetzen</button
          ><button
            type="button"
            class="focus-ring rounded-lg p-2 text-[#5c655f] hover:bg-[#f4f6f2]"
            aria-label="Editor schließen"
            @click="emit('cancel')"
          >
            <X :size="19" />
          </button>
        </div>
      </header>

      <div
        class="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,1fr)_112px] lg:grid-rows-[minmax(0,1fr)_auto]"
      >
        <main class="relative flex min-h-0 items-center justify-center bg-[#f7f8f6] p-4 sm:p-6">
          <div
            class="flex h-full w-full items-center justify-center overflow-hidden rounded-xl bg-[#edf0ec] p-3 sm:p-5"
          >
            <Cropper
              ref="cropper"
              class="photo-editor-cropper h-full w-full max-w-full"
              :style="{ filter: cssFilter }"
              :src="sourceUrl"
              :stencil-props="{ ...(aspectRatio ? { aspectRatio } : {}) }"
              :canvas="true"
              :check-orientation="true"
              image-restriction="stencil"
            />
          </div>
          <p
            class="absolute bottom-6 left-1/2 hidden -translate-x-1/2 rounded-full bg-[#122820]/70 px-3 py-1.5 text-[10px] font-medium text-white sm:block"
          >
            Vorschau · {{ sourceDimensions }}
          </p>
        </main>

        <nav
          class="order-first flex border-b border-[#e9ebe4] bg-white px-2 py-2 lg:order-none lg:row-span-2 lg:flex-col lg:border-b-0 lg:border-l lg:px-2 lg:py-4"
          aria-label="Bildbearbeitung"
        >
          <button
            v-for="tool in TOOLS"
            :key="tool.id"
            type="button"
            class="focus-ring flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 text-[10px] font-semibold sm:text-[11px] lg:flex-none lg:py-3"
            :class="
              activeTool === tool.id
                ? 'bg-[#e8efff] text-[#3754c8]'
                : 'text-[#52606d] hover:bg-[#f4f6f2]'
            "
            @click="selectTool(tool.id)"
          >
            <component :is="tool.icon" :size="21" stroke-width="1.7" /><span>{{ tool.label }}</span>
          </button>
        </nav>

        <section
          class="border-t border-[#e9ebe4] bg-white px-4 py-4 sm:px-6 lg:col-start-1"
          aria-live="polite"
        >
          <div v-if="activeTool === 'crop'" class="flex flex-wrap items-center gap-2">
            <div class="mr-2">
              <h3 class="text-sm font-bold">Zuschneiden & ausrichten</h3>
              <p class="text-[11px] text-[#7a817c]">Ziehe den Rahmen direkt in der Vorschau.</p>
            </div>
            <button
              v-for="option in ASPECT_RATIOS"
              :key="option.label"
              type="button"
              class="focus-ring rounded-lg px-3 py-2 text-xs font-semibold"
              :class="
                aspectRatio === option.value
                  ? 'bg-forest text-white'
                  : 'bg-[#eef1ea] text-[#5b625d]'
              "
              @click="aspectRatio = option.value"
            >
              {{ option.label }}
            </button>
            <span class="hidden h-7 border-l border-[#dfe0d9] sm:block" />
            <button
              type="button"
              class="focus-ring rounded-lg border border-[#dfe0d9] p-2 text-[#52606d]"
              aria-label="Nach links drehen"
              title="Nach links drehen"
              @click="rotate(-90)"
            >
              <RotateCcw :size="17" /></button
            ><button
              type="button"
              class="focus-ring rounded-lg border border-[#dfe0d9] p-2 text-[#52606d]"
              aria-label="Nach rechts drehen"
              title="Nach rechts drehen"
              @click="rotate(90)"
            >
              <RotateCw :size="17" /></button
            ><button
              type="button"
              class="focus-ring rounded-lg border border-[#dfe0d9] p-2 text-[#52606d]"
              aria-label="Horizontal spiegeln"
              title="Horizontal spiegeln"
              @click="flip(true, false)"
            >
              <FlipHorizontal2 :size="17" /></button
            ><button
              type="button"
              class="focus-ring rounded-lg border border-[#dfe0d9] p-2 text-[#52606d]"
              aria-label="Vertikal spiegeln"
              title="Vertikal spiegeln"
              @click="flip(false, true)"
            >
              <FlipVertical2 :size="17" />
            </button>
          </div>
          <div v-else-if="activeTool === 'adjust'" class="grid gap-4 sm:grid-cols-3">
            <div>
              <label class="flex justify-between text-xs font-semibold"
                >Helligkeit <span>{{ brightness }}%</span></label
              ><input
                v-model.number="brightness"
                class="mt-2 w-full accent-forest"
                type="range"
                min="50"
                max="150"
              />
            </div>
            <div>
              <label class="flex justify-between text-xs font-semibold"
                >Kontrast <span>{{ contrast }}%</span></label
              ><input
                v-model.number="contrast"
                class="mt-2 w-full accent-forest"
                type="range"
                min="50"
                max="150"
              />
            </div>
            <div>
              <label class="flex justify-between text-xs font-semibold"
                >Sättigung <span>{{ saturation }}%</span></label
              ><input
                v-model.number="saturation"
                class="mt-2 w-full accent-forest"
                type="range"
                min="0"
                max="200"
              />
            </div>
          </div>
          <div v-else-if="activeTool === 'filters'">
            <div class="mb-3">
              <h3 class="text-sm font-bold">Filter</h3>
              <p class="text-[11px] text-[#7a817c]">
                Die Auswahl wird auch beim Speichern übernommen.
              </p>
            </div>
            <div class="flex gap-2 overflow-x-auto pb-1">
              <button
                v-for="filter in FILTERS"
                :key="filter.id"
                type="button"
                class="focus-ring w-24 shrink-0 rounded-lg p-1.5 text-center text-[11px] font-semibold"
                :class="
                  selectedFilter === filter.id
                    ? 'bg-[#e8efff] text-[#3754c8]'
                    : 'bg-[#eef1ea] text-[#5b625d]'
                "
                @click="selectedFilter = filter.id"
              >
                <span
                  class="block h-10 rounded-md bg-gradient-to-br from-[#b9d7d4] via-[#ece0b6] to-[#5f8269]"
                  :style="{ filter: filter.className }"
                /><span class="mt-1 block truncate">{{ filter.label }}</span>
              </button>
            </div>
          </div>
          <div v-else class="flex flex-wrap items-end gap-3">
            <div class="mr-2">
              <h3 class="text-sm font-bold">Ausgabegröße</h3>
              <p class="text-[11px] text-[#7a817c]">Das Bild wird beim Speichern skaliert.</p>
            </div>
            <label class="grid gap-1 text-xs font-semibold"
              >Breite
              <input
                :value="outputWidth"
                class="w-24 rounded-lg border border-[#dfe0d9] px-2 py-2 text-sm"
                type="number"
                min="1"
                :max="MAX_OUTPUT_DIMENSION"
                @input="updateOutputWidth(($event.target as HTMLInputElement).value)" /></label
            ><span class="mb-2 text-[#7a817c]">×</span
            ><label class="grid gap-1 text-xs font-semibold"
              >Höhe
              <input
                :value="outputHeight"
                class="w-24 rounded-lg border border-[#dfe0d9] px-2 py-2 text-sm"
                type="number"
                min="1"
                :max="MAX_OUTPUT_DIMENSION"
                @input="updateOutputHeight(($event.target as HTMLInputElement).value)" /></label
            ><button
              type="button"
              class="focus-ring mb-0.5 inline-flex items-center gap-1 rounded-lg px-2 py-2 text-xs font-semibold text-[#52606d] hover:bg-[#f4f6f2]"
              :aria-pressed="keepAspectRatio"
              @click="keepAspectRatio = !keepAspectRatio"
            >
              <Lock v-if="keepAspectRatio" :size="15" /><Unlock v-else :size="15" /> Verhältnis
              {{ keepAspectRatio ? 'fix' : 'frei' }}</button
            ><span class="pb-2 text-[11px] text-[#7a817c]">px</span>
          </div>
          <p v-if="exportError" class="mt-3 text-xs text-red-700">{{ exportError }}</p>
        </section>
      </div>
      <footer
        class="flex shrink-0 items-center justify-between gap-3 border-t border-[#e9ebe4] bg-white px-4 py-3 sm:px-6"
      >
        <button
          type="button"
          class="focus-ring text-xs font-semibold text-[#5c655f] underline"
          @click="emit('cancel')"
        >
          Abbrechen</button
        ><button
          type="button"
          :disabled="exporting"
          class="focus-ring inline-flex items-center gap-2 rounded-xl bg-forest px-4 py-2.5 text-xs font-bold text-white disabled:opacity-60"
          @click="save"
        >
          <Check :size="15" />{{ exporting ? 'Wird übernommen …' : 'Foto übernehmen' }}
        </button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.photo-editor-cropper :deep(.vue-advanced-cropper) {
  background: transparent;
}
</style>
