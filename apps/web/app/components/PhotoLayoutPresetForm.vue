<script setup lang="ts">
import { LoaderCircle } from '@lucide/vue'
import type { PhotoLayoutKind } from '@vereinsfunk/contracts'
import type { PhotoLayoutPresetDraft } from '../utils/photoLayoutPresetDraft'

const props = withDefaults(defineProps<{
  saving: boolean
  error: string
  submitLabel?: string
  cancellable?: boolean
  primaryColor: string
  accentColor: string
}>(), {
  submitLabel: 'Anlegen',
  cancellable: false,
})

const draft = defineModel<PhotoLayoutPresetDraft>('draft', { required: true })

const emit = defineEmits<{ save: []; cancel: [] }>()

const KIND_OPTIONS: { value: PhotoLayoutKind; label: string; hint: string }[] = [
  { value: 'diagonal_split', label: 'Diagonal-Split', hint: '2 Fotos' },
  { value: 'grid_2x2', label: 'Raster 2×2', hint: '4 Fotos' },
  { value: 'mixed_grid', label: 'Gemischtes Raster', hint: '1 großes + kleine Fotos' },
]
// Feste, kleine Breite fuer die Galerie-Kacheln statt der tatsaechlich eingestellten
// dividerWidthPx (die bis zu 100px reichen kann) -- dieselbe Ueberlegung wie
// GALLERY_PREVIEW_WIDTH_PX in ImageStylePresetForm.vue.
const GALLERY_PREVIEW_WIDTH_PX = 4

type DividerColorMode = 'primary' | 'accent' | 'custom'
const dividerColorMode = computed<DividerColorMode>(() => (draft.value.dividerColor === 'primary' || draft.value.dividerColor === 'accent' ? draft.value.dividerColor : 'custom'))
function setDividerColorMode(mode: DividerColorMode) {
  draft.value.dividerColor = mode === 'custom' ? (draft.value.dividerColor.startsWith('#') ? draft.value.dividerColor : '#163a2c') : mode
}
const resolvedDividerColorHex = computed(() => {
  if (draft.value.dividerColor === 'primary') return props.primaryColor
  if (draft.value.dividerColor === 'accent') return props.accentColor
  return draft.value.dividerColor
})
function nullableNumberFromInput(event: Event): number | null {
  const value = (event.target as HTMLInputElement).value
  return value ? Number(value) : null
}

// Spiegelt PhotoLayoutPresetFieldsSchema (packages/contracts/src/photoLayout.ts) 1:1 -- der
// Speichern-Knopf bleibt deaktiviert, statt eine Anfrage zu schicken, die die API ohnehin
// ablehnen wuerde. Number.isInteger liefert bei einem leeren Zahlenfeld (v-model.number laesst
// dann den rohen leeren String stehen, siehe ImageStylePresetForm.vue) korrekt false.
const isValid = computed(() => {
  const value = draft.value
  if (!value.name.trim()) return false
  if (!Number.isInteger(value.dividerWidthPx) || value.dividerWidthPx < 0 || value.dividerWidthPx > 100) return false
  if (value.cornerRadiusPx !== null && (!Number.isInteger(value.cornerRadiusPx) || value.cornerRadiusPx < 0 || value.cornerRadiusPx > 200)) return false
  return true
})
</script>

<template>
  <section class="card mb-6 p-6">
    <label class="block text-xs font-semibold text-[#5c655f]">Name
      <input v-model="draft.name" type="text" maxlength="80" placeholder="z.B. Spieltag-Diagonal" class="focus-ring mt-1 w-full rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal" />
    </label>

    <div class="mt-5 border-t border-[#e9ebe4] pt-4">
      <p class="mb-2 text-xs font-semibold text-[#5c655f]">Layout</p>
      <div class="grid grid-cols-3 gap-2">
        <button v-for="option in KIND_OPTIONS" :key="option.value" type="button" :aria-pressed="draft.kind === option.value" class="focus-ring space-y-1 rounded-lg p-1.5" :class="draft.kind === option.value ? 'bg-forest' : 'bg-[#eef1ea]'" @click="draft.kind = option.value">
          <PhotoLayoutPreview :kind="option.value" :divider-color-hex="resolvedDividerColorHex" :divider-width-px="GALLERY_PREVIEW_WIDTH_PX" class="rounded-md" />
          <span class="block text-center text-[10px] font-semibold" :class="draft.kind === option.value ? 'text-white' : 'text-[#5b625d]'">{{ option.label }}</span>
          <span class="block text-center text-[9px]" :class="draft.kind === option.value ? 'text-white/80' : 'text-[#9aa096]'">{{ option.hint }}</span>
        </button>
      </div>
    </div>

    <div class="mt-5 border-t border-[#e9ebe4] pt-4">
      <p class="mb-2 text-xs font-semibold text-[#5c655f]">Trennlinie / Zwischenraum</p>
      <div class="flex flex-wrap items-center gap-2">
        <button type="button" :aria-pressed="dividerColorMode === 'primary'" class="focus-ring rounded-lg px-3 py-1.5 text-[11px] font-semibold" :class="dividerColorMode === 'primary' ? 'bg-forest text-white' : 'bg-[#eef1ea] text-[#5b625d]'" @click="setDividerColorMode('primary')">Vereinsfarbe</button>
        <button type="button" :aria-pressed="dividerColorMode === 'accent'" class="focus-ring rounded-lg px-3 py-1.5 text-[11px] font-semibold" :class="dividerColorMode === 'accent' ? 'bg-forest text-white' : 'bg-[#eef1ea] text-[#5b625d]'" @click="setDividerColorMode('accent')">Akzentfarbe</button>
        <button type="button" :aria-pressed="dividerColorMode === 'custom'" class="focus-ring rounded-lg px-3 py-1.5 text-[11px] font-semibold" :class="dividerColorMode === 'custom' ? 'bg-forest text-white' : 'bg-[#eef1ea] text-[#5b625d]'" @click="setDividerColorMode('custom')">Eigene Farbe</button>
        <input v-if="dividerColorMode === 'custom'" :value="draft.dividerColor" type="color" class="h-8 w-8 rounded border-0" @input="draft.dividerColor = ($event.target as HTMLInputElement).value" />
      </div>
      <label class="mt-3 block text-xs font-semibold text-[#5c655f]">Breite (px)
        <input v-model.number="draft.dividerWidthPx" type="number" min="0" max="100" class="focus-ring mt-1 w-32 rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal" />
      </label>
    </div>

    <div class="mt-5 border-t border-[#e9ebe4] pt-4">
      <label class="block text-xs font-semibold text-[#5c655f]">Eckenradius (px, optional)
        <input :value="draft.cornerRadiusPx ?? ''" type="number" min="0" max="200" placeholder="0" class="focus-ring mt-1 w-32 rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal" @input="draft.cornerRadiusPx = nullableNumberFromInput($event)" />
      </label>
    </div>

    <p v-if="error" class="mt-4 text-xs text-amber-800">{{ error }}</p>
    <div class="mt-5 flex gap-2">
      <button type="button" :disabled="saving || !isValid" class="focus-ring flex items-center gap-2 rounded-xl bg-forest px-4 py-2.5 text-xs font-bold text-white disabled:opacity-60" @click="emit('save')">
        <LoaderCircle v-if="saving" :size="14" class="animate-spin" /> {{ saving ? 'Wird gespeichert …' : submitLabel }}
      </button>
      <button v-if="cancellable" type="button" class="focus-ring rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-xs font-semibold" @click="emit('cancel')">Abbrechen</button>
    </div>
  </section>
</template>
