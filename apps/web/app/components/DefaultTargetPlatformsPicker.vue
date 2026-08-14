<script setup lang="ts">
import { SocialPlatformSchema, type SocialPlatform } from '@vereinsfunk/contracts'

// Plan 044, PR 1 Step 4: drei sichtbar unterscheidbare Zustaende -- geerbt (null, grauer
// Vorschauwert von oben), ausdruecklich keine Vorauswahl (eigene Auswahl mit keinem Haekchen) und
// eine eigene Auswahl. Ein Umschalter (geerbt/eigene Vorgabe) statt drei Radiobuttons, weil "leer"
// und "geerbt" sonst leicht zu verwechseln waeren -- das war genau der Fehler, den Plan 044 an
// mergeEffectiveConfig beheben musste (siehe packages/domain, mergeReplaceableList).
const props = defineProps<{
  disabled: boolean
  effectiveValue: readonly SocialPlatform[]
}>()

const ownValue = defineModel<SocialPlatform[] | null>('ownValue', { required: true })

const PLATFORM_LABELS: Record<SocialPlatform, string> = { instagram: 'Instagram', facebook: 'Facebook', website: 'Eigene Website' }
const isOwn = computed(() => ownValue.value !== null)

function setOwn(own: boolean) {
  ownValue.value = own ? [] : null
}
function toggle(platform: SocialPlatform) {
  if (ownValue.value === null) return
  ownValue.value = ownValue.value.includes(platform)
    ? ownValue.value.filter((entry) => entry !== platform)
    : [...ownValue.value, platform]
}
</script>

<template>
  <div>
    <div class="flex flex-wrap gap-3 text-sm">
      <label class="flex items-center gap-1.5">
        <input type="radio" name="default-target-platforms-mode" :checked="!isOwn" :disabled="props.disabled" @change="setOwn(false)" />
        geerbt
      </label>
      <label class="flex items-center gap-1.5">
        <input type="radio" name="default-target-platforms-mode" :checked="isOwn" :disabled="props.disabled" @change="setOwn(true)" />
        eigene Vorgabe
      </label>
    </div>
    <p v-if="!isOwn" class="mt-2 text-xs text-[#9aa096]">
      Übernimmt die Vorgabe der übergeordneten Ebene: {{ props.effectiveValue.length ? props.effectiveValue.map((platform) => PLATFORM_LABELS[platform]).join(', ') : 'keine Vorauswahl' }}.
    </p>
    <div v-else class="mt-2 flex flex-wrap gap-3">
      <label v-for="platform in SocialPlatformSchema.options" :key="platform" class="flex items-center gap-1.5 text-sm">
        <input type="checkbox" :checked="ownValue?.includes(platform) ?? false" :disabled="props.disabled" @change="toggle(platform)" />
        {{ PLATFORM_LABELS[platform] }}
      </label>
      <p v-if="ownValue?.length === 0" class="w-full text-xs text-[#9aa096]">Ausdrücklich keine Vorauswahl — die Auswahl in der Textwerkstatt startet leer.</p>
    </div>
  </div>
</template>
