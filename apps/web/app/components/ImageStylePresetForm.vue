<script setup lang="ts">
import { LoaderCircle } from '@lucide/vue'
import type { ImageStyleFilter, ImageStyleFrameStyle, ImageStyleFrameType, ImageStyleLogoPosition } from '@vereinsfunk/contracts'
import type { ImageStylePresetDraft } from '../utils/imageStylePresetDraft'

interface AssetOption { id: string; signedUrl: string; label: string; kind?: string }

const props = withDefaults(defineProps<{
  saving: boolean
  error: string
  submitLabel?: string
  cancellable?: boolean
  frameAssets: AssetOption[]
  logoAssets: AssetOption[]
  primaryColor: string
  accentColor: string
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
const FRAME_STYLE_OPTIONS: { value: ImageStyleFrameStyle; label: string }[] = [
  { value: 'solid', label: 'Schlicht' },
  { value: 'double', label: 'Doppelrand' },
  { value: 'corner_marks', label: 'Eckmarken' },
  { value: 'bottom_bar', label: 'Farbbalken' },
]
// Feste, kleine Breite fuer die Galerie-Kacheln statt des tatsaechlich eingestellten
// frameWidthPx (der bis zu 200px reichen kann) -- die Kacheln sollen die RahmenFORM
// unterscheidbar machen, nicht die exakte Staerke abbilden.
const GALLERY_PREVIEW_WIDTH_PX = 6

// Logovarianten sind seit der Lockerung des Fremdschluessels (2026082002) alle waehlbar, nicht nur
// als 'watermark' hochgeladene Bilder -- die Art wird deshalb vor dem Herkunftslabel eingeblendet,
// damit bei mehreren Treffern klar bleibt, welches Logo gemeint ist.
const LOGO_ASSET_KIND_LABELS: Record<string, string> = {
  logo_primary: 'Logo (hell)', logo_light: 'Logo (hell)', logo_dark: 'Logo (dunkel)',
  logo_mark: 'Symbol', wordmark: 'Wortmarke', watermark: 'Wasserzeichen',
}
function logoAssetLabel(asset: AssetOption): string {
  const kindLabel = asset.kind ? LOGO_ASSET_KIND_LABELS[asset.kind] ?? asset.kind : null
  return kindLabel ? `${kindLabel} · ${asset.label}` : asset.label
}

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
    if (!draft.value.frameStyle) draft.value.frameStyle = 'solid'
  } else if (type === 'custom') {
    draft.value.frameColor = null
    draft.value.frameWidthPx = null
    draft.value.frameCornerRadiusPx = null
    draft.value.frameStyle = null
  } else {
    draft.value.frameColor = null
    draft.value.frameWidthPx = null
    draft.value.frameCornerRadiusPx = null
    draft.value.frameBrandAssetId = null
    draft.value.frameStyle = null
  }
}
function setFrameStyle(style: ImageStyleFrameStyle) {
  draft.value.frameStyle = style
}
const resolvedFrameColorHex = computed(() => {
  if (draft.value.frameColor === 'primary') return props.primaryColor
  if (draft.value.frameColor === 'accent') return props.accentColor
  return draft.value.frameColor ?? '#163a2c'
})
// v-model.number liefert bei leerem Feld einen leeren String statt null (Vue-looseToNumber-
// Fallback) -- isValid erkennt das nicht und der Speichern-Knopf bliebe faelschlich aktiv.
function nullableNumberFromInput(event: Event): number | null {
  const value = (event.target as HTMLInputElement).value
  return value ? Number(value) : null
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
  if (value.frameType === 'parametric' && (value.frameColor === null || value.frameWidthPx === null || value.frameStyle === null)) return false
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
        <div class="grid grid-cols-4 gap-2">
          <button v-for="option in FRAME_STYLE_OPTIONS" :key="option.value" type="button" class="focus-ring space-y-1 rounded-lg p-1.5" :class="draft.frameStyle === option.value ? 'bg-forest' : 'bg-[#eef1ea]'" @click="setFrameStyle(option.value)">
            <ImageStyleFramePreview :frame-style="option.value" :width-px="GALLERY_PREVIEW_WIDTH_PX" :color-hex="resolvedFrameColorHex" class="rounded-md" />
            <span class="block text-center text-[10px] font-semibold" :class="draft.frameStyle === option.value ? 'text-white' : 'text-[#5b625d]'">{{ option.label }}</span>
          </button>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <button type="button" class="focus-ring rounded-lg px-3 py-1.5 text-[11px] font-semibold" :class="frameColorMode === 'primary' ? 'bg-forest text-white' : 'bg-[#eef1ea] text-[#5b625d]'" @click="setFrameColorMode('primary')">Vereinsfarbe</button>
          <button type="button" class="focus-ring rounded-lg px-3 py-1.5 text-[11px] font-semibold" :class="frameColorMode === 'accent' ? 'bg-forest text-white' : 'bg-[#eef1ea] text-[#5b625d]'" @click="setFrameColorMode('accent')">Akzentfarbe</button>
          <button type="button" class="focus-ring rounded-lg px-3 py-1.5 text-[11px] font-semibold" :class="frameColorMode === 'custom' ? 'bg-forest text-white' : 'bg-[#eef1ea] text-[#5b625d]'" @click="setFrameColorMode('custom')">Eigene Farbe</button>
          <input v-if="frameColorMode === 'custom'" :value="draft.frameColor" type="color" class="h-8 w-8 rounded border-0" @input="draft.frameColor = ($event.target as HTMLInputElement).value" />
        </div>
        <label class="block text-xs font-semibold text-[#5c655f]">Breite (px)
          <input :value="draft.frameWidthPx ?? ''" type="number" min="1" max="200" class="focus-ring mt-1 w-32 rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal" @input="draft.frameWidthPx = nullableNumberFromInput($event)" />
        </label>
        <label class="block text-xs font-semibold text-[#5c655f]">Eckenradius (px, optional)
          <input :value="draft.frameCornerRadiusPx ?? ''" type="number" min="0" max="200" placeholder="0" class="focus-ring mt-1 w-32 rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal" @input="draft.frameCornerRadiusPx = nullableNumberFromInput($event)" />
        </label>
      </div>

      <div v-else-if="draft.frameType === 'custom'" class="mt-4">
        <label class="block text-xs font-semibold text-[#5c655f]">Rahmengrafik
          <Select v-model="draft.frameBrandAssetId">
            <SelectTrigger class="mt-1 w-full max-w-sm rounded-xl px-4 py-2.5 text-sm font-normal"><SelectValue placeholder="Bitte wählen" /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="asset in frameAssets" :key="asset.id" :value="asset.id">{{ asset.label }}</SelectItem>
            </SelectContent>
          </Select>
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
          <Select v-model="draft.logoBrandAssetId">
            <SelectTrigger class="mt-1 w-full max-w-sm rounded-xl px-4 py-2.5 text-sm font-normal"><SelectValue placeholder="Bitte wählen" /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="asset in logoAssets" :key="asset.id" :value="asset.id">{{ logoAssetLabel(asset) }}</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <p v-if="!logoAssets.length" class="text-[11px] text-[#9aa096]">Noch kein Logo hinterlegt. Das geht über die Marke-Seite — jedes dort hochgeladene Logo (auch das Haupt-Logo) steht hier zur Auswahl.</p>
        <label class="block text-xs font-semibold text-[#5c655f]">Position
          <Select v-model="draft.logoPosition">
            <SelectTrigger class="mt-1 w-full max-w-sm rounded-xl px-4 py-2.5 text-sm font-normal"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="option in LOGO_POSITION_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <div class="flex gap-4">
          <label class="block text-xs font-semibold text-[#5c655f]">Größe (% der Bildbreite)
            <input :value="draft.logoSizePercent ?? ''" type="number" min="4" max="30" class="focus-ring mt-1 w-24 rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal" @input="draft.logoSizePercent = nullableNumberFromInput($event)" />
          </label>
          <label class="block text-xs font-semibold text-[#5c655f]">Abstand zum Rand (%)
            <input :value="draft.logoMarginPercent ?? ''" type="number" min="0" max="15" class="focus-ring mt-1 w-24 rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal" @input="draft.logoMarginPercent = nullableNumberFromInput($event)" />
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
