<script setup lang="ts">
import { Bot, CreditCard, Cpu, LayoutDashboard, LogOut, Menu, Settings, ShieldCheck, X } from '@lucide/vue'

const mobileOpen = ref(false)
const route = useRoute()
const session = await useSession()

watch(() => route.path, () => { mobileOpen.value = false })

const userInitials = computed(() => (session.value?.displayName ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join('').toUpperCase())

async function logout() {
  await signOut()
  await navigateTo('/anmelden')
}

const navigation: { label: string; to: string; icon: typeof LayoutDashboard }[] = [
  { label: 'Übersicht', to: '/plattform-admin', icon: LayoutDashboard },
  { label: 'Admins', to: '/plattform-admin/admins', icon: ShieldCheck },
  { label: 'Tarife', to: '/plattform-admin/tarife', icon: CreditCard },
  { label: 'Einstellungen', to: '/plattform-admin/einstellungen', icon: Settings },
  { label: 'LLM-Provider', to: '/plattform-admin/llm', icon: Cpu },
  { label: 'Personas', to: '/plattform-admin/personas', icon: Bot },
]
</script>

<template>
  <!--
    Same rationale as layouts/default.vue: session data is client-only, so the shell
    renders behind ClientOnly to avoid a server/client hydration mismatch.
  -->
  <ClientOnly>
  <div class="min-h-screen bg-oat lg:flex lg:h-screen lg:overflow-hidden">
    <header class="sticky top-0 z-40 flex h-16 items-center justify-between bg-forest px-4 lg:hidden">
      <AppLogo />
      <button class="focus-ring rounded-lg p-2 text-white" aria-label="Navigation öffnen" @click="mobileOpen = !mobileOpen">
        <X v-if="mobileOpen" :size="22" />
        <Menu v-else :size="22" />
      </button>
    </header>

    <div v-if="mobileOpen" class="fixed inset-0 z-30 bg-ink/40 backdrop-blur-sm lg:hidden" @click="mobileOpen = false" />
    <aside
      class="fixed bottom-0 left-0 top-0 z-30 flex w-[268px] flex-col overflow-y-auto bg-forest px-4 py-5 text-white transition-transform duration-200 lg:sticky lg:h-screen lg:min-h-0 lg:translate-x-0"
      :class="mobileOpen ? 'translate-x-0 pt-20' : '-translate-x-full'"
    >
      <div class="hidden px-2 pb-7 lg:block"><AppLogo /></div>

      <nav class="space-y-1" aria-label="Plattform-Administration">
        <NuxtLink v-for="item in navigation" :key="item.to" :to="item.to" class="focus-ring group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium text-white/65 transition hover:bg-white/[.07] hover:text-white" active-class="!bg-white/[.11] !text-white">
          <component :is="item.icon" :size="17" />
          <span class="flex-1">{{ item.label }}</span>
        </NuxtLink>
      </nav>

      <div class="mt-auto flex items-center gap-3 border-t border-white/10 px-2 pt-4">
        <span class="grid h-9 w-9 place-items-center rounded-full bg-[#d2c7ff] text-xs font-bold text-[#3c3260]">{{ userInitials }}</span>
        <span class="min-w-0 flex-1"><span class="block truncate text-xs font-semibold">{{ session?.displayName }}</span><span class="block text-[10px] text-white/45">Plattform-Administration</span></span>
        <button class="focus-ring rounded-lg p-1.5 text-white/45 hover:text-white" aria-label="Abmelden" @click="logout"><LogOut :size="15" /></button>
      </div>
    </aside>

    <main class="min-w-0 flex-1 lg:h-screen lg:min-h-0 lg:overflow-y-auto">
      <div class="mx-auto w-full max-w-[1280px] px-5 py-8 sm:px-10"><slot /></div>
    </main>
  </div>
    <template #fallback>
      <main class="grid min-h-screen place-items-center bg-oat px-5 text-sm text-[#7b827d]" aria-busy="true">
        Anwendung wird geladen …
      </main>
    </template>
  </ClientOnly>
</template>
