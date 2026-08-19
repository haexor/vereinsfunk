<script setup lang="ts">
import { LoaderCircle } from '@lucide/vue'
import type { ImageStyleFilter, ImageStyleFrameType, ImageStyleLogoPosition } from '@vereinsfunk/contracts'
import type { ImageStylePresetDraft } from '../utils/imageStylePresetDraft'

interface AssetOption { id: string; signedUrl: string; label: string }

withDefaults(defineProps<{
  saving: boolean
  error: string
  submitLabel?: string
  cancellable?: boolean
  frameAssets: AssetOption[]
  logoAssets: AssetOption[]
}>(), {
  submitLabel: 'Anlegen',
  cancellable: false,
})

const draft = defineModel<ImageStylePresetDraft>('draft', { required: true })

const emit = defineEmits<{ save: []; cancel: [] }>()

const FILTER_OPTIONS: { value: ImageStyleFilter; label: string }[] = [
  { value: 'original', label: 'Original' },
  { value: 'schwarz_weiss', label: 'Schwarz-Weiß' },
  { value: 'kontrastreich', label: 'Kontrastreich' },
  { value: 'warm', label: 'Warm' },
  { value: 'vereinsfarben_duoton', label: 'Vereinsfarben (Duoton)' },
]
const LOGO_POSITION_OPTIONS: { value: ImageStyleLogoPosition; label: string }[] = [
  { value: 'bottom_right', label: 'Unten rechts' },
  { value: 'bottom_left', label: 'Unten links' },
  { value: 'top_right', label: 'Oben rechts' },
  { value: 'top_left', label: 'Oben links' },
  { value: 'center', label: 'Mitte' },
]

// Farbe des parametrischen Rahmens: Vereinsfarbe/Akzentfarbe als Rollen (folgen Markenänderungen
// automatisch) oder eine fest eingetragene Hex-Farbe -- spiegelt die CHECK-Constraint der Migration
// (frame_color ~ Hex oder in ('primary','accent')).
type FrameColorMode = 'primary' | 'accent' | 'custom'
const frameColorMode = computed<FrameColorMode>(() => (draft.value.frameColor === 'primary' || draft.value.frameColor === 'accent' ? draft.value.frameColor : 'custom'))
function setFrameColorMode(mode: FrameColorMode) {
  draft.value.frameColor = mode === 'custom' ? (draft.value.frameColor && draft.value.frameColor.startsWith('#') ? draft.value.frameColor : '#163a2c') : mode
}
function setFrameType(type: ImageStyleFrameType) {
  draft.value.frameType = type
  if (type === 'parametric') {
    draft.value.frameBrandAssetId = null
    if (!draft.value.frameColor) draft.value.frameColor = 'primary'
    if (draft.value.frameWidthPx == null) draft.value.frameWidthPx = 8
  } else if (type === 'custom') {
    draft.value.frameColor = null
    draft.value.frameWidthPx = null
    draft.value.frameCornerRadiusPx = null
  } else {
    draft.value.frameColor = null
    draft.value.frameWidthPx = null
    draft.value.frameCornerRadiusPx = null
    draft.value.frameBrandAssetId = null
  }
}
function setLogoEnabled(enabled: boolean) {
  draft.value.logoEnabled = enabled
  if (enabled) {
    if (draft.value.logoSizePercent == null) draft.value.logoSizePercent = 12
    if (draft.value.logoMarginPercent == null) draft.value.logoMarginPercent = 4
  } else {
    draft.value.logoBrandAssetId = null
    draft.value.logoSizePercent = null
    draft.value.logoMarginPercent = null
  }
}

// Spiegelt checkImageStylePresetFields (packages/contracts/src/imageStyle.ts) 1:1 -- der Speichern-
// Knopf bleibt deaktiviert, statt eine Anfrage zu schicken, die die API ohnehin ablehnen würde.
const isValid = computed(() => {
  const value = draft.value
  if (!value.name.trim()) return false
  if (value.frameType === 'parametric' && (value.frameColor === null || value.frameWidthPx === null)) return false
  if ((value.frameType === 'custom') !== (value.frameBrandAssetId !== null)) return false
  const logoFieldsComplete = value.logoBrandAssetId !== null && value.logoSizePercent !== null && value.logoMarginPercent !== null
  if (value.logoEnabled !== logoFieldsComplete) return false
  return true
})
</script>

<template>
  <section class="card mb-6 p-6">
    <label class="block text-xs font-semibold text-[#5c655f]">Name
      <input v-model="draft.name" type="text" maxlength="80" placeholder="z.B. Spieltag-Rahmen" class="focus-ring mt-1 w-full rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal" />
    </label>

    <div class="mt-5 border-t border-[#e9ebe4] pt-4">
      <p class="mb-2 text-xs font-semibold text-[#5c655f]">Rahmen</p>
      <div class="flex flex-wrap gap-2">
        <button type="button" class="focus-ring rounded-lg px-3 py-1.5 text-[11px] font-semibold" :class="draft.frameType === 'none' ? 'bg-forest text-white' : 'bg-[#eef1ea] text-[#5b625d]'" @click="setFrameType('none')">Kein Rahmen</button>
        <button type="button" class="focus-ring rounded-lg px-3 py-1.5 text-[11px] font-semibold" :class="draft.frameType === 'parametric' ? 'bg-forest text-white' : 'bg-[#eef1ea] text-[#5b625d]'" @click="setFrameType('parametric')">Farbe & Breite</button>
        <button type="button" class="focus-ring rounded-lg px-3 py-1.5 text-[11px] font-semibold" :class="draft.frameType === 'custom' ? 'bg-forest text-white' : 'bg-[#eef1ea] text-[#5b625d]'" @click="setFrameType('custom')">Eigene Rahmengrafik</button>
      </div>

      <div v-if="draft.frameType === 'parametric'" class="mt-4 space-y-3">
        <div class="flex flex-wrap items-center gap-2">
          <button type="button" class="focus-ring rounded-lg px-3 py-1.5 text-[11px] font-semibold" :class="frameColorMode === 'primary' ? 'bg-forest text-white' : 'bg-[#eef1ea] text-[#5b625d]'" @click="setFrameColorMode('primary')">Vereinsfarbe</button>
          <button type="button" class="focus-ring rounded-lg px-3 py-1.5 text-[11px] font-semibold" :class="frameColorMode === 'accent' ? 'bg-forest text-white' : 'bg-[#eef1ea] text-[#5b625d]'" @click="setFrameColorMode('accent')">Akzentfarbe</button>
          <button type="button" class="focus-ring rounded-lg px-3 py-1.5 text-[11px] font-semibold" :class="frameColorMode === 'custom' ? 'bg-forest text-white' : 'bg-[#eef1ea] text-[#5b625d]'" @click="setFrameColorMode('custom')">Eigene Farbe</button>
          <input v-if="frameColorMode === 'custom'" :value="draft.frameColor" type="color" class="h-8 w-8 rounded border-0" @input="draft.frameColor = ($event.target as HTMLInputElement).value" />
        </div>
        <label class="block text-xs font-semibold text-[#5c655f]">Breite (px)
          <input :value="draft.frameWidthPx ?? ''" type="number" min="1" max="200" class="focus-ring mt-1 w-32 rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal" @input="draft.frameWidthPx = ($event.target as HTMLInputElement).value ? Number(($event.target as HTMLInputElement).value) : null" />
        </label>
        <label class="block text-xs font-semibold text-[#5c655f]">Eckenradius (px, optional)
          <input :value="draft.frameCornerRadiusPx ?? ''" type="number" min="0" max="200" placeholder="0" class="focus-ring mt-1 w-32 rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal" @input="draft.frameCornerRadiusPx = ($event.target as HTMLInputElement).value ? Number(($event.target as HTMLInputElement).value) : null" />
        </label>
      </div>

      <div v-else-if="draft.frameType === 'custom'" class="mt-4">
        <label class="block text-xs font-semibold text-[#5c655f]">Rahmengrafik
          <select v-model="draft.frameBrandAssetId" class="focus-ring mt-1 w-full max-w-sm rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal">
            <option :value="null" disabled>Bitte wählen</option>
            <option v-for="asset in frameAssets" :key="asset.id" :value="asset.id">{{ asset.label }}</option>
          </select>
        </label>
        <p v-if="!frameAssets.length" class="mt-2 text-[11px] text-[#9aa096]">Noch keine Rahmengrafik hochgeladen. Das geht über die Marke-Seite (Asset-Art „Rahmen“).</p>
      </div>
    </div>

    <div class="mt-5 border-t border-[#e9ebe4] pt-4">
      <label class="flex items-center gap-2 text-xs font-semibold text-[#5c655f]">
        <input :checked="draft.logoEnabled" type="checkbox" class="accent-[#163a2c]" @change="setLogoEnabled(($event.target as HTMLInputElement).checked)" /> Logo als Wasserzeichen einblenden
      </label>
      <div v-if="draft.logoEnabled" class="mt-3 space-y-3">
        <label class="block text-xs font-semibold text-[#5c655f]">Logo-Asset
          <select v-model="draft.logoBrandAssetId" class="focus-ring mt-1 w-full max-w-sm rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal">
            <option :value="null" disabled>Bitte wählen</option>
            <option v-for="asset in logoAssets" :key="asset.id" :value="asset.id">{{ asset.label }}</option>
          </select>
        </label>
        <p v-if="!logoAssets.length" class="text-[11px] text-[#9aa096]">Noch kein Wasserzeichen hochgeladen. Das geht über die Marke-Seite (Asset-Art „Wasserzeichen“).</p>
        <label class="block text-xs font-semibold text-[#5c655f]">Position
          <select v-model="draft.logoPosition" class="focus-ring mt-1 w-full max-w-sm rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal">
            <option v-for="option in LOGO_POSITION_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
        </label>
        <div class="flex gap-4">
          <label class="block text-xs font-semibold text-[#5c655f]">Größe (% der Bildbreite)
            <input :value="draft.logoSizePercent ?? ''" type="number" min="4" max="30" class="focus-ring mt-1 w-24 rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal" @input="draft.logoSizePercent = ($event.target as HTMLInputElement).value ? Number(($event.target as HTMLInputElement).value) : null" />
          </label>
          <label class="block text-xs font-semibold text-[#5c655f]">Abstand zum Rand (%)
            <input :value="draft.logoMarginPercent ?? ''" type="number" min="0" max="15" class="focus-ring mt-1 w-24 rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal" @input="draft.logoMarginPercent = ($event.target as HTMLInputElement).value ? Number(($event.target as HTMLInputElement).value) : null" />
          </label>
        </div>
      </div>
    </div>

    <div class="mt-5 border-t border-[#e9ebe4] pt-4">
      <p class="mb-2 text-xs font-semibold text-[#5c655f]">Filter</p>
      <div class="flex flex-wrap gap-2">
        <button v-for="option in FILTER_OPTIONS" :key="option.value" type="button" class="focus-ring rounded-lg px-3 py-1.5 text-[11px] font-semibold" :class="draft.filter === option.value ? 'bg-forest text-white' : 'bg-[#eef1ea] text-[#5b625d]'" @click="draft.filter = option.value">
          {{ option.label }}
        </button>
      </div>
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
