<script setup lang="ts">
import { computed } from 'vue'
import { renderAgentMarkdown } from '../utils/agentMarkdown'

const props = defineProps<{ content: string }>()
const renderedContent = computed(() => renderAgentMarkdown(props.content))
</script>

<template>
  <!-- markdown-it has HTML disabled, so this only receives renderer-generated, escaped HTML. -->
  <div class="agent-markdown break-words" v-html="renderedContent" />
</template>
