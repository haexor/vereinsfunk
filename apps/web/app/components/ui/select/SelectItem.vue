<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { Check } from '@lucide/vue'
import { SelectItem, SelectItemIndicator, SelectItemText, type SelectItemProps, useForwardProps } from 'reka-ui'
import { cn } from '~/utils/cn'

const props = defineProps<SelectItemProps & { class?: HTMLAttributes['class'] }>()

// class steckt schon in cn(...) unten -- ohne dieses Aussortieren binden die Forward-Props es
// ein zweites Mal an die reka-ui-Komponente (undefined-Werte laesst useForwardProps weg).
const delegatedProps = computed(() => ({ ...props, class: undefined }))

const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <SelectItem
    v-bind="forwardedProps"
    :class="cn(
      'focus-ring relative flex w-full cursor-pointer items-center rounded-lg py-2 pr-8 pl-2 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-[#eff4e6]',
      props.class,
    )"
  >
    <span class="absolute right-2 flex size-4 items-center justify-center">
      <SelectItemIndicator>
        <Check :size="16" class="text-forest" />
      </SelectItemIndicator>
    </span>
    <SelectItemText>
      <slot />
    </SelectItemText>
  </SelectItem>
</template>
