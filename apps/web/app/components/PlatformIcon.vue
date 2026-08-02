<script setup lang="ts">
const props = defineProps<{ platform: 'instagram' | 'facebook'; inverse?: boolean }>()
</script>

<template>
  <span
    class="grid h-6 w-6 place-items-center rounded-full text-[10px] font-bold"
    :class="props.inverse ? 'bg-white/15 text-white' : 'bg-[#eef0ea] text-forest'"
    :title="props.platform === 'instagram' ? 'Instagram' : 'Facebook'"
  >
    {{ props.platform === 'instagram' ? 'IG' : 'f' }}
  </span>
</template>
