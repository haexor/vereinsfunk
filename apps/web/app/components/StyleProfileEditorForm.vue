<script setup lang="ts">
import { LoaderCircle, Plus, Sparkles, Terminal, Trash2 } from '@lucide/vue'
import type { GeneratedPost } from '@vereinsfunk/contracts'
import type { StyleProfileDraft } from '../utils/styleProfileDraft'

withDefaults(defineProps<{
  saving: boolean
  error: string
  previewing: boolean
  previewResult: GeneratedPost | null
  previewError: string
  promptPreviewing: boolean
  promptPreviewResult: { system: string; user: string } | null
  promptPreviewError: string
  submitLabel?: string
  cancellable?: boolean
}>(), {
  submitLabel: 'Speichern',
  cancellable: false,
})

const draft = defineModel<StyleProfileDraft>('draft', { required: true })

const emit = defineEmits<{ save: []; preview: []; promptPreview: []; cancel: [] }>()

const canPreview = computed(() => Boolean(draft.value.name.trim() && draft.value.description.trim() && draft.value.sampleInput.trim()))

const MAX_EXAMPLES = 5
const TABS = [
  { id: 'grunddaten', label: 'Grunddaten' },
  { id: 'tonalitaet', label: 'Tonalität' },
  { id: 'sprachstil', label: 'Sprachstil' },
  { id: 'beispiele', label: 'Beispiele' },
] as const
type TabId = typeof TABS[number]['id']
const activeTab = ref<TabId>('grunddaten')
</script>

<template>
  <section class="card mb-6 p-6">
    <div class="mb-5 flex flex-wrap gap-1 border-b border-[#e9ebe4]">
      <button
        v-for="tab in TABS"
        :key="tab.id"
        type="button"
        class="focus-ring -mb-px border-b-2 px-3 py-2 text-xs font-semibold transition-colors"
        :class="activeTab === tab.id ? 'border-forest text-forest' : 'border-transparent text-[#9aa096] hover:text-[#5c655f]'"
        @click="activeTab = tab.id"
      >
        {{ tab.label }}
      </button>
    </div>

    <div v-show="activeTab === 'grunddaten'" class="space-y-4">
      <label class="block text-xs font-semibold text-[#5c655f]">Name
        <input v-model="draft.name" type="text" maxlength="80" placeholder="z.B. Kapitän Klar" class="focus-ring mt-1 w-full rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal" />
      </label>
      <label class="block text-xs font-semibold text-[#5c655f]">Beschreibung
        <textarea v-model="draft.description" rows="3" maxlength="500" placeholder="Kurzbeschreibung für die Auswahl in der Textwerkstatt" class="focus-ring mt-1 w-full rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal" />
      </label>
    </div>

    <div v-show="activeTab === 'tonalitaet'" class="grid gap-4 sm:grid-cols-2">
      <label class="text-xs font-semibold text-[#5c655f]">Tonalitäts-Tags (eine je Zeile, z.B. „lebendig“, „bodenständig“)
        <textarea v-model="draft.toneTagsText" rows="8" class="focus-ring mt-1 w-full rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal" />
      </label>
      <label class="text-xs font-semibold text-[#5c655f]">Catchphrases (eine je Zeile)
        <textarea v-model="draft.catchphrasesText" rows="8" class="focus-ring mt-1 w-full rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal" />
      </label>
    </div>

    <div v-show="activeTab === 'sprachstil'" class="space-y-4">
      <div class="grid gap-4 sm:grid-cols-2">
        <label class="text-xs font-semibold text-[#5c655f]">Sprachstil-Regeln — worauf achten (eine je Zeile, z.B. Perspektive, Satzbau)
          <textarea v-model="draft.doRulesText" rows="8" class="focus-ring mt-1 w-full rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal" />
        </label>
        <label class="text-xs font-semibold text-[#5c655f]">Don'ts — zu vermeiden (eine je Zeile)
          <textarea v-model="draft.avoidRulesText" rows="8" class="focus-ring mt-1 w-full rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal" />
        </label>
      </div>
      <label class="block text-xs font-semibold text-[#5c655f]">Zusätzliche Anweisung (max. 1000 Zeichen, niedrig priorisiert)
        <textarea v-model="draft.additionalInstructions" rows="3" maxlength="1000" class="focus-ring mt-1 w-full rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal" />
        <p class="mt-1 text-[11px] font-normal text-[#9aa096]">{{ draft.additionalInstructions.length }}/1000 Zeichen</p>
      </label>
    </div>

    <div v-show="activeTab === 'beispiele'" class="space-y-4">
      <p v-if="!draft.examples.length" class="rounded-xl border border-dashed border-[#dfe0d9] p-4 text-xs text-[#9aa096]">
        Noch kein Beispiel hinzugefügt. Ein Beispielpaar zeigt, wie ein Rohtext in den fertigen Stil übersetzt werden soll.
      </p>
      <div v-for="(example, index) in draft.examples" :key="index" class="rounded-xl border border-[#dfe0d9] p-4">
        <div class="mb-2 flex items-center justify-between">
          <p class="text-xs font-semibold text-[#5c655f]">Beispiel {{ index + 1 }}</p>
          <button type="button" class="focus-ring rounded-lg p-1 text-[#9aa096] hover:text-amber-800" @click="draft.examples.splice(index, 1)">
            <Trash2 :size="14" />
          </button>
        </div>
        <label class="block text-xs font-semibold text-[#5c655f]">Input (Rohtext/Anlass)
          <textarea v-model="example.input" rows="2" maxlength="300" placeholder="z.B. 3:1 Sieg im Lokalderby, Tore: Müller, Meier" class="focus-ring mt-1 w-full rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal" />
        </label>
        <label class="mt-3 block text-xs font-semibold text-[#5c655f]">Output (so soll der Text klingen)
          <textarea v-model="example.output" rows="4" maxlength="1500" class="focus-ring mt-1 w-full rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal" />
        </label>
      </div>
      <button
        type="button"
        :disabled="draft.examples.length >= MAX_EXAMPLES"
        class="focus-ring inline-flex items-center gap-2 rounded-xl border border-dashed border-[#dfe0d9] px-4 py-2.5 text-xs font-bold text-[#43483f] disabled:opacity-40"
        @click="draft.examples.push({ input: '', output: '' })"
      >
        <Plus :size="14" /> Beispiel hinzufügen
      </button>
    </div>

    <div class="mt-5 border-t border-[#e9ebe4] pt-4">
      <p class="mb-2 text-xs font-semibold text-[#5c655f]">Persona/Stilprofil testen</p>
      <label class="text-xs font-semibold text-[#5c655f]">Beispieltext (Anlass, für den ein Testtext erzeugt wird)
        <input v-model="draft.sampleInput" type="text" maxlength="300" placeholder="z.B. Sieg im Auswärtsspiel, 2:0" class="focus-ring mt-1 w-full rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal" />
      </label>
      <div class="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          :disabled="!canPreview || previewing"
          class="focus-ring inline-flex items-center gap-2 rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-xs font-bold text-[#43483f] disabled:opacity-60"
          @click="emit('preview')"
        >
          <LoaderCircle v-if="previewing" :size="14" class="animate-spin" /><Sparkles v-else :size="14" />
          {{ previewing ? 'Wird getestet …' : 'Persona/Stilprofil testen' }}
        </button>
        <button
          type="button"
          :disabled="!canPreview || promptPreviewing"
          class="focus-ring inline-flex items-center gap-2 rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-xs font-bold text-[#43483f] disabled:opacity-60"
          @click="emit('promptPreview')"
        >
          <LoaderCircle v-if="promptPreviewing" :size="14" class="animate-spin" /><Terminal v-else :size="14" />
          {{ promptPreviewing ? 'Wird geladen …' : 'System-Prompt anzeigen' }}
        </button>
      </div>
      <p v-if="previewError" class="mt-2 text-xs text-amber-800">{{ previewError }}</p>
      <div v-if="previewResult" class="mt-3 rounded-xl bg-[#f4f6f1] p-3">
        <p class="text-xs font-bold">{{ previewResult.headline }}</p>
        <p class="mt-1 whitespace-pre-wrap text-xs text-[#43483f]">{{ previewResult.caption }}</p>
        <p v-if="previewResult.hashtags.length" class="mt-2 text-[11px] text-[#7b827d]">{{ previewResult.hashtags.join(' ') }}</p>
      </div>
      <p v-if="promptPreviewError" class="mt-2 text-xs text-amber-800">{{ promptPreviewError }}</p>
      <div v-if="promptPreviewResult" class="mt-3 space-y-2">
        <div class="rounded-xl bg-[#f4f6f1] p-3">
          <p class="text-[11px] font-semibold uppercase tracking-wide text-[#9aa096]">System</p>
          <pre class="mt-1 max-h-64 overflow-auto whitespace-pre-wrap text-xs text-[#43483f]">{{ promptPreviewResult.system }}</pre>
        </div>
        <div class="rounded-xl bg-[#f4f6f1] p-3">
          <p class="text-[11px] font-semibold uppercase tracking-wide text-[#9aa096]">Nutzer</p>
          <pre class="mt-1 max-h-64 overflow-auto whitespace-pre-wrap text-xs text-[#43483f]">{{ promptPreviewResult.user }}</pre>
        </div>
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
