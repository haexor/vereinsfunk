<script setup lang="ts">
import { FileText, Globe } from '@lucide/vue'
import type { SocialPlatform } from '@vereinsfunk/contracts'

const props = defineProps<{ platform: SocialPlatform; inverse?: boolean }>()
</script>

<template>
  <span
    class="grid h-6 w-6 shrink-0 place-items-center rounded-full"
    :class="props.inverse ? 'bg-white/15' : ''"
    :style="props.inverse ? {} : { backgroundColor: platformColors[props.platform] }"
    :title="platformLabels[props.platform]"
  >
    <svg v-if="platformIconPaths[props.platform]" viewBox="0 0 16 16" class="h-3.5 w-3.5 fill-white"><path :d="platformIconPaths[props.platform]" /></svg>
    <!-- 'plaintext' hat keine Marke wie 'website', aber Globe waere hier irrefuehrend (kein
    URL-Kanal) -- eigenes Fallback statt beide auf dasselbe Symbol zu mappen (Review PR #181). -->
    <FileText v-else-if="props.platform === 'plaintext'" :size="14" class="text-white" />
    <Globe v-else :size="14" class="text-white" />
  </span>
</template>
