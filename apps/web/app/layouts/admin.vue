<script setup lang="ts">
import { Bot, CreditCard, Cpu, Images, LayoutDashboard, Settings, ShieldCheck } from '@lucide/vue'
import type { ShellNavItem } from '../composables/useShellNavigation'

const session = await useSession()

const navigation: ShellNavItem[] = [
  { label: 'Übersicht', to: '/plattform-admin', icon: LayoutDashboard },
  { label: 'Admins', to: '/plattform-admin/admins', icon: ShieldCheck },
  { label: 'Tarife', to: '/plattform-admin/tarife', icon: CreditCard },
  { label: 'Einstellungen', to: '/plattform-admin/einstellungen', icon: Settings },
  { label: 'LLM-Provider', to: '/plattform-admin/llm', icon: Cpu },
  { label: 'Vision-Vergleich', to: '/plattform-admin/vision-vergleich', icon: Images },
  { label: 'Personas', to: '/plattform-admin/personas', icon: Bot },
]
const navClasses = { quiet: 'text-white/45', nav: 'text-white/65 hover:bg-white/[.07] hover:text-white', activeNav: '!bg-white/[.11] !text-white' }
const footerClasses = { footer: 'border-white/10', quiet: 'text-white/45', muted: 'text-white/45 hover:text-white' }
</script>

<template>
  <AppShell surface-class="bg-forest text-white">
    <template #sidebar>
      <SidebarNavSection :items="navigation" label="Plattform-Administration" :classes="navClasses" />
      <SidebarUserFooter
        :display-name="session?.displayName ?? ''"
        role-label="Plattform-Administration"
        :classes="footerClasses"
      />
    </template>
    <slot />
  </AppShell>
</template>
