<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { ChevronDown } from '@lucide/vue'
import { SelectIcon, SelectTrigger, type SelectTriggerProps, useForwardProps } from 'reka-ui'
import { cn } from '~/utils/cn'

const props = defineProps<SelectTriggerProps & { class?: HTMLAttributes['class'] }>()

const forwardedProps = useForwardProps(props)
</script>

<template>
  <SelectTrigger
    v-bind="forwardedProps"
    :class="cn(
      'focus-ring flex w-full items-center justify-between gap-2 rounded-xl border border-[#dfe0d9] bg-transparent p-3 text-left text-sm disabled:cursor-not-allowed disabled:opacity-60 [&>span]:min-w-0 [&>span]:flex-1 [&>span]:truncate',
      props.class,
    )"
  >
    <slot />
    <SelectIcon as-child>
      <ChevronDown :size="16" class="shrink-0 text-[#9aa096]" />
    </SelectIcon>
  </SelectTrigger>
</template>
