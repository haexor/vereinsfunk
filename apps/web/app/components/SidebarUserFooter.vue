<script setup lang="ts">
import { LogOut, UserRound } from '@lucide/vue'
import { initialsOf } from '../utils/initials'
import type { SidebarClasses } from '../utils/sidebarBrand'

const props = defineProps<{
  displayName: string
  roleLabel: string
  classes: Pick<SidebarClasses, 'footer' | 'quiet' | 'muted'>
  showProfileLink?: boolean
}>()

const initials = computed(() => initialsOf(props.displayName))
</script>

<template>
  <div class="mt-auto flex items-center gap-3 border-t px-2 pt-4" :class="classes.footer">
    <span
      class="grid h-9 w-9 place-items-center rounded-full bg-[#d2c7ff] text-xs font-bold text-[#3c3260]"
      >{{ initials }}</span
    >
    <span class="min-w-0 flex-1"
      ><span class="block truncate text-xs font-semibold">{{ displayName }}</span
      ><span class="block text-[10px]" :class="classes.quiet">{{ roleLabel }}</span></span
    >
    <NuxtLink
      v-if="showProfileLink"
      to="/profil"
      class="focus-ring rounded-lg p-1.5"
      :class="classes.muted"
      aria-label="Profil"
      ><UserRound :size="15"
    /></NuxtLink>
    <button
      class="focus-ring rounded-lg p-1.5"
      :class="classes.muted"
      aria-label="Abmelden"
      @click="signOut()"
    >
      <LogOut :size="15" />
    </button>
  </div>
</template>
