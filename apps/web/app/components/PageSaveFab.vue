<script setup lang="ts">
import { Check, LoaderCircle } from '@lucide/vue'

const action = useActivePageSaveFab()
const isSaving = computed(() => action.value?.saving.value ?? false)
const isDisabled = computed(() => !action.value || isSaving.value || action.value.disabled?.value === true)
const isVisible = computed(() => action.value?.visible?.value !== false)
const icon = computed(() => action.value?.icon ?? Check)
const savingLabel = computed(() => action.value?.savingLabel ?? 'Wird gespeichert …')

async function save() {
  if (!action.value || isDisabled.value) return
  await action.value.save()
}
</script>

<template>
  <button
    v-if="action && isVisible"
    type="button"
    class="focus-ring fixed bottom-5 right-5 z-20 flex items-center gap-2 rounded-full bg-forest px-5 py-3 text-xs font-bold text-white shadow-lg shadow-forest/25 transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60 sm:bottom-7 sm:right-7"
    :disabled="isDisabled"
    @click="save"
  >
    <LoaderCircle v-if="isSaving" :size="16" class="animate-spin" />
    <component :is="icon" v-else :size="16" />
    {{ isSaving ? savingLabel : action.label }}
  </button>
</template>
