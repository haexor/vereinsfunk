<script setup lang="ts">
import { LoaderCircle } from '@lucide/vue'
import type { ContentSignatureBlockDraft } from '../utils/contentSignatureBlockDraft'

withDefaults(defineProps<{
  saving: boolean
  error: string
  submitLabel?: string
  cancellable?: boolean
}>(), {
  submitLabel: 'Anlegen',
  cancellable: false,
})

const draft = defineModel<ContentSignatureBlockDraft>('draft', { required: true })

const emit = defineEmits<{ save: []; cancel: [] }>()

const isValid = computed(() => draft.value.name.trim().length > 0 && draft.value.body.trim().length > 0)
</script>

<template>
  <section class="card mb-6 p-6">
    <label class="block text-xs font-semibold text-[#5c655f]">Name
      <input v-model="draft.name" type="text" maxlength="80" placeholder="z.B. Standard-CTA" class="focus-ring mt-1 w-full rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal" />
    </label>
    <label class="mt-4 block text-xs font-semibold text-[#5c655f]">Text
      <textarea v-model="draft.body" maxlength="1000" rows="4" placeholder="z.B. Mehr auf unserer Website: https://euer-verein.de" class="focus-ring mt-1 w-full rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal" />
    </label>
    <p class="mt-1 text-[11px] text-[#9aa096]">{{ draft.body.length }}/1000 Zeichen</p>

    <p v-if="error" role="alert" class="mt-4 text-xs text-amber-800">{{ error }}</p>
    <div class="mt-5 flex gap-2">
      <button type="button" :disabled="saving || !isValid" class="focus-ring flex items-center gap-2 rounded-xl bg-forest px-4 py-2.5 text-xs font-bold text-white disabled:opacity-60" @click="emit('save')">
        <LoaderCircle v-if="saving" :size="14" class="animate-spin" /> {{ saving ? 'Wird gespeichert …' : submitLabel }}
      </button>
      <button v-if="cancellable" type="button" class="focus-ring rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-xs font-semibold" @click="emit('cancel')">Abbrechen</button>
    </div>
  </section>
</template>
