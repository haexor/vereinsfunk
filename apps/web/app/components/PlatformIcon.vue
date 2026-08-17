<script setup lang="ts">
import type { SocialPlatform } from '@vereinsfunk/contracts'

const props = defineProps<{ platform: SocialPlatform; inverse?: boolean }>()
</script>

<template>
  <span
    class="grid h-6 w-6 place-items-center rounded-full text-[10px] font-bold"
    :class="props.inverse ? 'bg-white/15 text-white' : 'bg-[#eef0ea] text-forest'"
    :title="platformLabels[props.platform]"
  >
    {{ platformGlyphs[props.platform] }}
  </span>
</template>
