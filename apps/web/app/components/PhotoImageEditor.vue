<script setup lang="ts">
import { Check, FlipHorizontal2, FlipVertical2, RotateCcw, RotateCw, X } from '@lucide/vue'
import { Cropper } from 'vue-advanced-cropper'
import 'vue-advanced-cropper/dist/style.css'

const props = defineProps<{ file: File }>()
const emit = defineEmits<{ save: [file: File]; cancel: [] }>()

type CropperController = {
  getResult: () => { canvas?: HTMLCanvasElement }
  rotate: (angle: number) => void
  flip: (horizontal: boolean, vertical: boolean) => void
  reset: () => void
}

const cropper = ref<CropperController | null>(null)
const sourceUrl = ref('')
const aspectRatio = ref<number | undefined>(undefined)
const exporting = ref(false)
const exportError = ref('')

const ASPECT_RATIOS: { label: string; value: number | undefined }[] = [
  { label: 'Frei', value: undefined },
  { label: '1:1', value: 1 },
  { label: '4:5', value: 4 / 5 },
  { label: '16:9', value: 16 / 9 },
]

function updateSourceUrl(file: File) {
  const previousUrl = sourceUrl.value
  sourceUrl.value = URL.createObjectURL(file)
  if (previousUrl) URL.revokeObjectURL(previousUrl)
}

onMounted(() => { updateSourceUrl(props.file) })
watch(() => props.file, updateSourceUrl)
onBeforeUnmount(() => { if (sourceUrl.value) URL.revokeObjectURL(sourceUrl.value) })

function rotate(angle: number) { cropper.value?.rotate(angle) }
function flip(horizontal: boolean, vertical: boolean) { cropper.value?.flip(horizontal, vertical) }
function reset() { cropper.value?.reset() }

async function save() {
  const canvas = cropper.value?.getResult().canvas
  if (!canvas) {
    exportError.value = 'Der Bildausschnitt ist noch nicht bereit.'
    return
  }
  exporting.value = true
  exportError.value = ''
  try {
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
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-[#122820]/60 p-4" role="dialog" aria-modal="true" aria-labelledby="photo-editor-title">
    <section class="max-h-full w-full max-w-4xl overflow-auto rounded-2xl bg-white p-5 shadow-2xl sm:p-6">
      <div class="flex items-start justify-between gap-4">
        <div>
          <h2 id="photo-editor-title" class="font-display text-xl font-bold">Foto bearbeiten</h2>
          <p class="mt-1 text-xs text-[#727a75]">Ausschnitt ziehen, Social-Format wählen oder das Bild drehen. Erst danach beginnt die Personenprüfung.</p>
        </div>
        <button type="button" class="focus-ring rounded-lg p-1.5 text-[#5c655f]" aria-label="Editor schließen" @click="emit('cancel')"><X :size="18" /></button>
      </div>

      <Cropper
        ref="cropper"
        class="mt-5 h-[min(58vh,560px)] w-full overflow-hidden rounded-xl bg-[#202723]"
        :src="sourceUrl"
        :stencil-props="{ ...(aspectRatio ? { aspectRatio } : {}) }"
        :canvas="true"
        :check-orientation="true"
        image-restriction="stencil"
      />

      <div class="mt-4 flex flex-wrap items-center gap-2">
        <span class="mr-1 text-xs font-semibold text-[#5c655f]">Format</span>
        <button v-for="option in ASPECT_RATIOS" :key="option.label" type="button" class="focus-ring rounded-lg px-3 py-1.5 text-xs font-semibold" :class="aspectRatio === option.value ? 'bg-forest text-white' : 'bg-[#eef1ea] text-[#5b625d]'" @click="aspectRatio = option.value">{{ option.label }}</button>
        <span class="mx-1 hidden h-5 border-l border-[#dfe0d9] sm:block" />
        <button type="button" class="focus-ring rounded-lg border border-[#dfe0d9] p-1.5" aria-label="Nach links drehen" title="Nach links drehen" @click="rotate(-90)"><RotateCcw :size="16" /></button>
        <button type="button" class="focus-ring rounded-lg border border-[#dfe0d9] p-1.5" aria-label="Nach rechts drehen" title="Nach rechts drehen" @click="rotate(90)"><RotateCw :size="16" /></button>
        <button type="button" class="focus-ring rounded-lg border border-[#dfe0d9] p-1.5" aria-label="Horizontal spiegeln" title="Horizontal spiegeln" @click="flip(true, false)"><FlipHorizontal2 :size="16" /></button>
        <button type="button" class="focus-ring rounded-lg border border-[#dfe0d9] p-1.5" aria-label="Vertikal spiegeln" title="Vertikal spiegeln" @click="flip(false, true)"><FlipVertical2 :size="16" /></button>
        <button type="button" class="focus-ring ml-auto text-xs text-[#5c655f] underline" @click="reset">Zurücksetzen</button>
      </div>
      <p v-if="exportError" class="mt-3 text-xs text-red-700">{{ exportError }}</p>
      <div class="mt-5 flex justify-end gap-2">
        <button type="button" class="focus-ring rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-xs font-semibold" @click="emit('cancel')">Abbrechen</button>
        <button type="button" :disabled="exporting" class="focus-ring inline-flex items-center gap-2 rounded-xl bg-forest px-4 py-2.5 text-xs font-bold text-white disabled:opacity-60" @click="save"><Check :size="15" />{{ exporting ? 'Wird übernommen …' : 'Ausschnitt übernehmen' }}</button>
      </div>
    </section>
  </div>
</template>
