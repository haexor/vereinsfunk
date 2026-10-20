<script setup lang="ts">
import { Check, LoaderCircle, Sparkles } from '@lucide/vue'
import type { BrandWebsiteAnalysisResult } from '@vereinsfunk/contracts'

// Darstellung der KI-Markenerkennung aus der gespeicherten Homepage. Der Lauf selbst (Polling,
// Uebernahme der Vorschlaege) bleibt auf der Seite: sie lebt weiter, wenn diese Karte waehrend
// eines Neuladens kurz verschwindet.
defineProps<{
  isDepartment: boolean
  running: boolean
  starting: boolean
  startDisabled: boolean
  needsSaving: boolean
  startError: string
  failureMessage: string
  applied: boolean
  detectedFontNotice: string
  logoCandidates: BrandWebsiteAnalysisResult['logoCandidates']
  logoApplied: readonly boolean[]
}>()
const emit = defineEmits<{ start: []; 'apply-logo': [index: number] }>()
</script>

<template>
  <section class="card p-6">
    <h2 class="font-display flex items-center gap-2 text-base font-bold">
      <Sparkles :size="16" /> Automatisch aus der Homepage übernehmen
    </h2>
    <p class="mt-2 text-xs text-[#7a817c]">
      {{
        isDepartment
          ? 'Primärfarbe und Akzentfarbe aus der Homepage dieser Abteilung vorschlagen lassen.'
          : 'Primärfarbe, Akzentfarbe und eine Schriftempfehlung aus eurer Vereins-Homepage vorschlagen lassen.'
      }}
      Gefundene Logos erscheinen unten als eigene Vorschläge zum Übernehmen. Farben und Schrift
      werden erst mit „Änderungen speichern“ unten dauerhaft übernommen.
    </p>
    <div class="mt-4 flex flex-wrap items-center gap-2">
      <button
        type="button"
        class="focus-ring flex items-center gap-1.5 rounded-lg bg-forest px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
        :disabled="startDisabled"
        @click="emit('start')"
      >
        <LoaderCircle
          v-if="running || starting"
          :size="14"
          class="animate-spin"
        /><Sparkles v-else :size="14" />
        {{ running ? 'Analyse läuft …' : 'Analyse starten' }}
      </button>
    </div>
    <p v-if="needsSaving" class="mt-2 text-[11px] text-[#7a817c]">
      Bitte die Homepage-Adresse zuerst mit „Änderungen speichern“ sichern.
    </p>
    <p v-if="startError" class="mt-2 text-[11px] text-amber-800">
      {{ startError }}
    </p>
    <p v-else-if="failureMessage" class="mt-2 text-[11px] text-amber-800">
      {{ failureMessage }}
    </p>
    <p
      v-if="applied"
      class="mt-2 flex items-center gap-1.5 text-[11px] text-emerald-700"
    >
      <Check :size="12" /> Farb-/Schriftvorschlag übernommen — bitte prüfen und unten
      speichern.
    </p>
    <p v-if="detectedFontNotice" class="mt-2 text-[11px] text-[#7a817c]">
      {{ detectedFontNotice }}
    </p>
    <div v-if="logoCandidates.length" class="mt-4">
      <p class="text-[11px] font-semibold text-[#7b827d]">
        Gefundene Logos — einzeln prüfen und übernehmen
      </p>
      <div class="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div
          v-for="(candidate, index) in logoCandidates"
          :key="candidate.signedUrl"
          class="rounded-xl border border-[#e1e2db] p-2 text-center"
        >
          <img :src="candidate.signedUrl" alt="" class="mx-auto h-12 w-12 object-contain" />
          <button
            type="button"
            class="focus-ring mt-1.5 block w-full rounded-lg bg-forest px-2 py-1 text-[10px] font-bold text-white disabled:opacity-50"
            :disabled="logoApplied[index]"
            @click="emit('apply-logo', index)"
          >
            {{ logoApplied[index] ? 'Übernommen' : 'Übernehmen' }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
