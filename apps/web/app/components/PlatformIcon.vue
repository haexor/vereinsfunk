<script setup lang="ts">
import type { SocialPlatform } from '@vereinsfunk/contracts'

const props = defineProps<{ platform: SocialPlatform; inverse?: boolean }>()

const LABELS: Record<SocialPlatform, string> = { instagram: 'Instagram', facebook: 'Facebook', website: 'Eigene Website' }
const GLYPHS: Record<SocialPlatform, string> = { instagram: 'IG', facebook: 'f', website: '🌐' }
</script>

<template>
  <span
    class="grid h-6 w-6 place-items-center rounded-full text-[10px] font-bold"
    :class="props.inverse ? 'bg-white/15 text-white' : 'bg-[#eef0ea] text-forest'"
    :title="LABELS[props.platform]"
  >
    {{ GLYPHS[props.platform] }}
  </span>
</template>
