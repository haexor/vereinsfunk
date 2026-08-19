<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { SelectSeparator, type SelectSeparatorProps, useForwardProps } from 'reka-ui'
import { cn } from '~/utils/cn'

const props = defineProps<SelectSeparatorProps & { class?: HTMLAttributes['class'] }>()

const forwardedProps = useForwardProps(props)
</script>

<template>
  <SelectSeparator v-bind="forwardedProps" :class="cn('-mx-1 my-1 h-px bg-[#dfe0d9]', props.class)" />
</template>
