<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { SelectContent, type SelectContentEmits, type SelectContentProps, SelectPortal, SelectViewport, useForwardPropsEmits } from 'reka-ui'
import { cn } from '~/utils/cn'
import SelectScrollDownButton from './SelectScrollDownButton.vue'
import SelectScrollUpButton from './SelectScrollUpButton.vue'

defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<SelectContentProps & { class?: HTMLAttributes['class'] }>(), {
  position: 'popper',
})
const emits = defineEmits<SelectContentEmits>()

// class steckt schon in cn(...) unten -- ohne dieses Aussortieren binden die Forward-Props es
// ein zweites Mal an die reka-ui-Komponente (undefined-Werte laesst useForwardProps weg).
const delegatedProps = computed(() => ({ ...props, class: undefined }))

const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <SelectPortal>
    <SelectContent
      v-bind="{ ...forwarded, ...$attrs }"
      :class="cn(
        'relative z-50 max-h-96 min-w-32 overflow-hidden rounded-xl border border-[#dfe0d9] bg-[#fcfcf8] shadow-lg',
        position === 'popper' && 'data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1',
        props.class,
      )"
    >
      <SelectScrollUpButton />
      <SelectViewport
        :class="cn(
          'p-1',
          position === 'popper' && 'h-(--reka-select-trigger-height) w-full min-w-(--reka-select-trigger-width)',
        )"
      >
        <slot />
      </SelectViewport>
      <SelectScrollDownButton />
    </SelectContent>
  </SelectPortal>
</template>
