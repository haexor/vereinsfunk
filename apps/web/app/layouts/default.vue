<script setup lang="ts">
import { BarChart3, CalendarDays, CheckCircle2, ChevronDown, FileText, LayoutDashboard, LogOut, Menu, Palette, Plus, Settings, Users, X } from '@lucide/vue'

const roleLabels: Record<string, string> = {
  organization_owner: 'Vereinsinhaber',
  organization_admin: 'Vereinsadmin',
  social_manager: 'Social Managerin',
  billing_admin: 'Abrechnung',
  organization_viewer: 'Betrachterin',
  department_admin: 'Abteilungsadmin',
  editor: 'Redakteurin',
  approver: 'Prüferin',
  contributor: 'Mitwirkende',
  viewer: 'Betrachterin',
  team_manager: 'Teamleitung',
}

const mobileOpen = ref(false)
const route = useRoute()
const session = await useSession()
const scope = await useScope()

watch(() => route.path, () => { mobileOpen.value = false })

const activeOrganization = computed(() => session.value?.scopes.find((item) => item.organizationId === scope.value?.organizationId) ?? null)
const organizationInitials = computed(() => (activeOrganization.value?.organizationName ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join('').toUpperCase())
const activeDepartmentRoles = computed(() => activeOrganization.value?.departments.find((item) => item.id === scope.value?.departmentId)?.roles ?? [])
const topRoleLabel = computed(() => {
  const role = activeOrganization.value?.organizationRoles[0] ?? activeDepartmentRoles.value[0]
  return role ? roleLabels[role] ?? role : ''
})
const userInitials = computed(() => (session.value?.displayName ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join('').toUpperCase())

function selectDepartment(departmentId: string) {
  if (scope.value) scope.value = { ...scope.value, departmentId }
}

async function logout() {
  await signOut()
  await navigateTo('/anmelden')
}

const navigation: { label: string; to: string; icon: typeof LayoutDashboard; badge?: number }[] = [
  { label: 'Übersicht', to: '/', icon: LayoutDashboard },
  { label: 'Beiträge', to: '/beitraege', icon: FileText },
  { label: 'Freigaben', to: '/freigaben', icon: CheckCircle2 },
  { label: 'Kalender', to: '/kalender', icon: CalendarDays },
  { label: 'Auswertung', to: '/auswertung', icon: BarChart3 },
]
const organizationNav = [
  { label: 'Marke & Tonalität', to: '/marke', icon: Palette },
  { label: 'Mitglieder', to: '/mitglieder', icon: Users },
  { label: 'Einstellungen', to: '/einstellungen', icon: Settings },
]
</script>

<template>
  <div class="min-h-screen bg-oat lg:flex">
    <header class="sticky top-0 z-40 flex h-16 items-center justify-between bg-forest px-4 lg:hidden">
      <AppLogo />
      <button class="focus-ring rounded-lg p-2 text-white" aria-label="Navigation öffnen" @click="mobileOpen = !mobileOpen">
        <X v-if="mobileOpen" :size="22" />
        <Menu v-else :size="22" />
      </button>
    </header>

    <div v-if="mobileOpen" class="fixed inset-0 z-30 bg-ink/40 backdrop-blur-sm lg:hidden" @click="mobileOpen = false" />
    <aside
      class="fixed bottom-0 left-0 top-0 z-30 flex w-[268px] flex-col bg-forest px-4 py-5 text-white transition-transform duration-200 lg:sticky lg:translate-x-0"
      :class="mobileOpen ? 'translate-x-0 pt-20' : '-translate-x-full'"
    >
      <div class="hidden px-2 pb-7 lg:block"><AppLogo /></div>

      <div v-if="activeOrganization" class="mb-5 rounded-2xl border border-white/10 bg-white/[.06] p-2">
        <button class="focus-ring flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-white/[.06]">
          <span class="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-lime font-display text-sm font-extrabold text-forest">{{ organizationInitials }}</span>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm font-semibold">{{ activeOrganization.organizationName }}</span>
            <span class="block text-[11px] text-white/55">Vereinskonto</span>
          </span>
          <ChevronDown :size="15" class="text-white/50" />
        </button>
        <template v-if="activeOrganization.departments.length">
          <div class="mx-2 my-1 h-px bg-white/10" />
          <label class="relative block">
            <span class="sr-only">Abteilung auswählen</span>
            <select :value="scope?.departmentId" class="focus-ring w-full appearance-none rounded-lg bg-transparent py-2 pl-2 pr-8 text-xs font-medium text-white/80" @change="selectDepartment(($event.target as HTMLSelectElement).value)">
              <option v-for="item in activeOrganization.departments" :key="item.id" :value="item.id" class="text-ink">{{ item.name }}</option>
            </select>
            <ChevronDown :size="14" class="pointer-events-none absolute right-2 top-2.5 text-white/50" />
          </label>
        </template>
      </div>

      <NuxtLink to="/erstellen" class="focus-ring mb-6 flex items-center justify-center gap-2 rounded-xl bg-lime px-4 py-3 text-sm font-bold text-forest transition hover:-translate-y-0.5 hover:bg-[#d5ff6c]">
        <Plus :size="17" stroke-width="2.5" /> Beitrag erstellen
      </NuxtLink>

      <nav class="space-y-1" aria-label="Hauptnavigation">
        <NuxtLink v-for="item in navigation" :key="item.to" :to="item.to" class="focus-ring group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium text-white/65 transition hover:bg-white/[.07] hover:text-white" active-class="!bg-white/[.11] !text-white">
          <component :is="item.icon" :size="17" />
          <span class="flex-1">{{ item.label }}</span>
          <span v-if="item.badge" class="grid h-5 min-w-5 place-items-center rounded-full bg-coral px-1 text-[10px] font-bold text-white">{{ item.badge }}</span>
        </NuxtLink>
      </nav>

      <div class="mb-2 mt-7 px-3 text-[10px] font-bold uppercase tracking-[.14em] text-white/35">Verein verwalten</div>
      <nav class="space-y-1" aria-label="Vereinsverwaltung">
        <NuxtLink v-for="item in organizationNav" :key="item.to" :to="item.to" class="focus-ring flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium text-white/65 transition hover:bg-white/[.07] hover:text-white" active-class="!bg-white/[.11] !text-white">
          <component :is="item.icon" :size="17" />{{ item.label }}
        </NuxtLink>
      </nav>

      <div class="mt-auto flex items-center gap-3 border-t border-white/10 px-2 pt-4">
        <span class="grid h-9 w-9 place-items-center rounded-full bg-[#d2c7ff] text-xs font-bold text-[#3c3260]">{{ userInitials }}</span>
        <span class="min-w-0 flex-1"><span class="block truncate text-xs font-semibold">{{ session?.displayName }}</span><span class="block text-[10px] text-white/45">{{ topRoleLabel }}</span></span>
        <button class="focus-ring rounded-lg p-1.5 text-white/45 hover:text-white" aria-label="Abmelden" @click="logout"><LogOut :size="15" /></button>
      </div>
    </aside>

    <main class="min-w-0 flex-1"><slot /></main>
  </div>
</template>
