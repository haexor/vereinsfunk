<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { ChevronDown } from '@lucide/vue'
import { SelectScrollDownButton, type SelectScrollDownButtonProps, useForwardProps } from 'reka-ui'
import { cn } from '~/utils/cn'

const props = defineProps<SelectScrollDownButtonProps & { class?: HTMLAttributes['class'] }>()

// class steckt schon in cn(...) unten -- ohne dieses Aussortieren binden die Forward-Props es
// ein zweites Mal an die reka-ui-Komponente (undefined-Werte laesst useForwardProps weg).
const delegatedProps = computed(() => ({ ...props, class: undefined }))

const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <SelectScrollDownButton v-bind="forwardedProps" :class="cn('flex cursor-default items-center justify-center py-1', props.class)">
    <ChevronDown :size="14" class="text-[#9aa096]" />
  </SelectScrollDownButton>
</template>
