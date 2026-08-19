<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { SelectLabel, type SelectLabelProps, useForwardProps } from 'reka-ui'
import { cn } from '~/utils/cn'

const props = defineProps<SelectLabelProps & { class?: HTMLAttributes['class'] }>()

const forwardedProps = useForwardProps(props)
</script>

<template>
  <SelectLabel v-bind="forwardedProps" :class="cn('px-2 py-1.5 text-[11px] font-semibold text-[#9aa096]', props.class)">
    <slot />
  </SelectLabel>
</template>
