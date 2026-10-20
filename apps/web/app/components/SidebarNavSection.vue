<script setup lang="ts">
import type { ShellNavItem } from '../composables/useShellNavigation'
import type { SidebarClasses } from '../utils/sidebarBrand'

defineProps<{
  items: readonly ShellNavItem[]
  // Zugaenglicher Name der Navigation (aria-label).
  label: string
  heading?: string
  classes: Pick<SidebarClasses, 'quiet' | 'nav' | 'activeNav'>
}>()
</script>

<template>
  <div
    v-if="heading"
    class="mb-2 mt-7 px-3 text-[10px] font-bold uppercase tracking-[.14em]"
    :class="classes.quiet"
  >
    {{ heading }}
  </div>
  <nav class="space-y-1" :aria-label="label">
    <NuxtLink
      v-for="item in items"
      :key="item.to"
      :to="item.to"
      class="focus-ring flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition"
      :class="classes.nav"
      :active-class="classes.activeNav"
    >
      <component :is="item.icon" :size="17" />
      <span class="flex-1">{{ item.label }}</span>
      <span
        v-if="item.badge"
        class="grid h-5 min-w-5 place-items-center rounded-full bg-coral px-1 text-[10px] font-bold text-ink"
        >{{ item.badge }}</span
      >
    </NuxtLink>
  </nav>
</template>
