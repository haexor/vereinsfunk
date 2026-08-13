<script setup lang="ts">
import { LoaderCircle, Sparkles } from '@lucide/vue'
import type { GeneratedPost } from '@vereinsfunk/contracts'
import type { StyleProfileDraft } from '../utils/styleProfileDraft'

withDefaults(defineProps<{
  saving: boolean
  error: string
  previewing: boolean
  previewResult: GeneratedPost | null
  previewError: string
  submitLabel?: string
  cancellable?: boolean
}>(), {
  submitLabel: 'Speichern',
  cancellable: false,
})

const draft = defineModel<StyleProfileDraft>('draft', { required: true })

const emit = defineEmits<{ save: []; preview: []; cancel: [] }>()

const canPreview = computed(() => Boolean(draft.value.name.trim() && draft.value.description.trim() && draft.value.sampleInput.trim()))
</script>

<template>
  <section class="card mb-6 p-6">
    <div class="grid gap-3 sm:grid-cols-2">
      <label class="text-xs font-semibold text-[#5c655f] sm:col-span-2">Name
        <input v-model="draft.name" type="text" maxlength="80" placeholder="z.B. Kapitän Klar" class="focus-ring mt-1 w-full rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal" />
      </label>
      <label class="text-xs font-semibold text-[#5c655f] sm:col-span-2">Beschreibung
        <textarea v-model="draft.description" rows="2" maxlength="500" placeholder="Kurzbeschreibung für die Auswahl in der Textwerkstatt" class="focus-ring mt-1 w-full rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal" />
      </label>

      <label class="text-xs font-semibold text-[#5c655f]">Tonalitäts-Tags (eine je Zeile, z.B. „lebendig“, „bodenständig“)
        <textarea v-model="draft.toneTagsText" rows="3" class="focus-ring mt-1 w-full rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal" />
      </label>
      <label class="text-xs font-semibold text-[#5c655f]">Catchphrases (eine je Zeile)
        <textarea v-model="draft.catchphrasesText" rows="3" class="focus-ring mt-1 w-full rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal" />
      </label>

      <label class="text-xs font-semibold text-[#5c655f]">Don'ts — zu vermeiden (eine je Zeile)
        <textarea v-model="draft.avoidRulesText" rows="3" class="focus-ring mt-1 w-full rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal" />
      </label>
      <label class="text-xs font-semibold text-[#5c655f]">Do's — worauf achten (eine je Zeile)
        <textarea v-model="draft.doRulesText" rows="3" class="focus-ring mt-1 w-full rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal" />
      </label>

      <label class="text-xs font-semibold text-[#5c655f]">Beispiel-Input (Rohtext/Anlass)
        <textarea v-model="draft.exampleInput" rows="2" maxlength="300" placeholder="z.B. 3:1 Sieg im Lokalderby, Tore: Müller, Meier" class="focus-ring mt-1 w-full rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal" />
      </label>
      <label class="text-xs font-semibold text-[#5c655f]">Beispiel-Output (so soll der Text klingen)
        <textarea v-model="draft.exampleOutput" rows="2" maxlength="1500" class="focus-ring mt-1 w-full rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal" />
      </label>

      <label class="text-xs font-semibold text-[#5c655f] sm:col-span-2">Zusätzliche Anweisung (max. 1000 Zeichen, niedrig priorisiert)
        <textarea v-model="draft.additionalInstructions" rows="2" maxlength="1000" class="focus-ring mt-1 w-full rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal" />
        <p class="mt-1 text-[11px] font-normal text-[#9aa096]">{{ draft.additionalInstructions.length }}/1000 Zeichen</p>
      </label>
    </div>

    <div class="mt-5 border-t border-[#e9ebe4] pt-4">
      <p class="mb-2 text-xs font-semibold text-[#5c655f]">Persona/Stilprofil testen</p>
      <label class="text-xs font-semibold text-[#5c655f]">Beispieltext (Anlass, für den ein Testtext erzeugt wird)
        <input v-model="draft.sampleInput" type="text" maxlength="300" placeholder="z.B. Sieg im Auswärtsspiel, 2:0" class="focus-ring mt-1 w-full rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal" />
      </label>
      <button
        type="button"
        :disabled="!canPreview || previewing"
        class="focus-ring mt-3 inline-flex items-center gap-2 rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-xs font-bold text-[#43483f] disabled:opacity-60"
        @click="emit('preview')"
      >
        <LoaderCircle v-if="previewing" :size="14" class="animate-spin" /><Sparkles v-else :size="14" />
        {{ previewing ? 'Wird getestet …' : 'Persona/Stilprofil testen' }}
      </button>
      <p v-if="previewError" class="mt-2 text-xs text-amber-800">{{ previewError }}</p>
      <div v-if="previewResult" class="mt-3 rounded-xl bg-[#f4f6f1] p-3">
        <p class="text-xs font-bold">{{ previewResult.headline }}</p>
        <p class="mt-1 whitespace-pre-wrap text-xs text-[#43483f]">{{ previewResult.caption }}</p>
        <p v-if="previewResult.hashtags.length" class="mt-2 text-[11px] text-[#7b827d]">{{ previewResult.hashtags.join(' ') }}</p>
      </div>
    </div>

    <p v-if="error" class="mt-3 text-xs text-amber-800">{{ error }}</p>
    <div class="mt-4 flex gap-2">
      <button type="button" :disabled="saving" class="focus-ring rounded-xl bg-forest px-4 py-2.5 text-xs font-bold text-white disabled:opacity-60" @click="emit('save')">
        {{ saving ? 'Wird gespeichert …' : submitLabel }}
      </button>
      <button v-if="cancellable" type="button" class="focus-ring rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-xs font-semibold" @click="emit('cancel')">Abbrechen</button>
    </div>
  </section>
</template>
