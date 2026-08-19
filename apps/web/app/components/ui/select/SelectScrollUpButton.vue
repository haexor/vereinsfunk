<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { ChevronUp } from '@lucide/vue'
import { SelectScrollUpButton, type SelectScrollUpButtonProps, useForwardProps } from 'reka-ui'
import { cn } from '~/utils/cn'

const props = defineProps<SelectScrollUpButtonProps & { class?: HTMLAttributes['class'] }>()

// class steckt schon in cn(...) unten -- ohne dieses Aussortieren binden die Forward-Props es
// ein zweites Mal an die reka-ui-Komponente (undefined-Werte laesst useForwardProps weg).
const delegatedProps = computed(() => ({ ...props, class: undefined }))

const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <SelectScrollUpButton v-bind="forwardedProps" :class="cn('flex cursor-default items-center justify-center py-1', props.class)">
    <ChevronUp :size="14" class="text-[#9aa096]" />
  </SelectScrollUpButton>
</template>
