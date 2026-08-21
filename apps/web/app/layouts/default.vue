<script setup lang="ts">
import { BarChart3, BookUser, Building2, CalendarDays, CheckCircle2, CreditCard, Feather, FileText, Frame, LayoutDashboard, LayoutGrid, LogOut, Menu, Palette, Plug, Plus, Scale, Settings, Share2, ShieldCheck, Users, UserRound, UserSearch, X } from '@lucide/vue'

const mobileOpen = ref(false)
const route = useRoute()
const session = await useSession()
const scope = await useScope()

watch(() => route.path, () => { mobileOpen.value = false })

const activeOrganization = computed(() => session.value?.scopes.find((item) => item.organizationId === scope.value?.organizationId) ?? null)
const organizationInitials = computed(() => (activeOrganization.value?.organizationName ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join('').toUpperCase())

// Paket 013, Rueckbau: das Vereinslogo ersetzt die Initialen dort, wo der Verein tatsaechlich
// als Marke auftritt -- diese kleine Kachel im Umschalter, nicht die geteilte AppLogo-Komponente.
// AppLogo bleibt bewusst unveraendert: sie steht auch in layouts/admin.vue und layouts/auth.vue,
// wo es keinen (oder noch keinen einzelnen) aktiven Verein gibt -- dort waere ein Vereinslogo
// fachlich falsch, es ist die Produktmarke "vereinsfunk", nicht die des Vereins.
const organizationLogoUrl = ref('')
watch(
  () => scope.value?.organizationId,
  async (organizationId) => {
    organizationLogoUrl.value = ''
    if (!organizationId) return
    const supabase = useSupabaseClient()
    const result = await supabase.from('organization_brand_profiles').select('logo_path').eq('organization_id', organizationId).maybeSingle()
    // Nach jedem await pruefen, ob der Verein inzwischen gewechselt hat: sonst kann ein frueher
    // gestarteter Durchlauf nach einem spaeteren zurueckkehren und das Logo des vorigen Vereins
    // in den Umschalter schreiben.
    if (scope.value?.organizationId !== organizationId) return
    if (!result.data?.logo_path) return
    const signed = await supabase.storage.from('brand-assets').createSignedUrl(result.data.logo_path, 600)
    if (scope.value?.organizationId !== organizationId) return
    organizationLogoUrl.value = signed.data?.signedUrl ?? ''
  },
  { immediate: true },
)
const activeDepartmentRoles = computed(() => activeOrganization.value?.departments.find((item) => item.id === scope.value?.departmentId)?.roles ?? [])
const topRoleLabel = computed(() => {
  const role = activeOrganization.value?.organizationRoles[0] ?? activeDepartmentRoles.value[0]
  return role ? roleLabels[role] ?? role : ''
})
const userInitials = computed(() => (session.value?.displayName ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join('').toUpperCase())

function selectDepartment(departmentId: string) {
  if (scope.value) scope.value = { ...scope.value, departmentId }
}

function selectOrganization(organizationId: string) {
  const organization = session.value?.scopes.find((item) => item.organizationId === organizationId)
  if (organization) scope.value = { organizationId, departmentId: organization.departments[0]?.id ?? null }
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
  { label: 'Marke', to: '/marke', icon: Palette },
  { label: 'Bildstil', to: '/bildstil', icon: Frame },
  { label: 'Bildkomposition', to: '/bildkomposition', icon: LayoutGrid },
  { label: 'Stilprofile', to: '/stilprofile', icon: Feather },
  { label: 'Struktur', to: '/struktur', icon: Building2 },
  { label: 'Mitglieder', to: '/mitglieder', icon: Users },
  { label: 'Verzeichnis', to: '/verzeichnis', icon: BookUser },
  { label: 'Einwilligungen', to: '/einwilligungen', icon: ShieldCheck },
  { label: 'Kanäle', to: '/kanaele', icon: Share2 },
  { label: 'Integrationen', to: '/integrationen', icon: Plug },
  { label: 'Einstellungen', to: '/einstellungen', icon: Settings },
  { label: 'Tarif', to: '/einstellungen/tarif', icon: CreditCard },
  { label: 'Recht & Datenschutz', to: '/einstellungen/recht', icon: Scale },
  { label: 'Betroffenenanfragen', to: '/datenschutz/anfragen', icon: UserSearch },
]
</script>

<template>
  <!--
    Authenticated session and scope data are intentionally only available in the browser.
    Rendering the shell on the server would therefore produce an empty sidebar and page,
    which differs from the first client render and causes Vue hydration mismatches.
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

      <div v-if="activeOrganization" class="mb-5 rounded-2xl border border-white/10 bg-white/[.06] p-2">
        <div class="flex w-full items-center gap-3 p-2 text-left">
          <img v-if="organizationLogoUrl" :src="organizationLogoUrl" alt="" class="h-9 w-9 shrink-0 rounded-xl bg-lime object-contain p-1" />
          <span v-else class="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-lime font-display text-sm font-extrabold text-forest">{{ organizationInitials }}</span>
          <span v-if="(session?.scopes.length ?? 0) <= 1" class="min-w-0 flex-1">
            <span class="block truncate text-sm font-semibold">{{ activeOrganization.organizationName }}</span>
            <span class="block text-[11px] text-white/55">Vereinskonto</span>
          </span>
          <div v-else class="relative block min-w-0 flex-1">
            <Select :model-value="scope?.organizationId ?? ''" @update:model-value="(value: unknown) => selectOrganization(value as string)">
              <SelectTrigger aria-label="Verein auswählen" class="border-0 py-1 pr-6 pl-0 text-sm font-semibold text-white [&_svg]:text-white/50">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="item in session?.scopes" :key="item.organizationId" :value="item.organizationId">{{ item.organizationName }}</SelectItem>
              </SelectContent>
            </Select>
            <span class="block text-[11px] text-white/55">Vereinskonto</span>
          </div>
        </div>
        <template v-if="activeOrganization.departments.length">
          <div class="mx-2 my-1 h-px bg-white/10" />
          <div class="relative block">
            <Select :model-value="scope?.departmentId ?? ''" @update:model-value="(value: unknown) => selectDepartment(value as string)">
              <SelectTrigger aria-label="Abteilung auswählen" class="border-0 py-2 pr-8 pl-2 text-xs font-medium text-white/80 [&_svg]:text-white/50">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="item in activeOrganization.departments" :key="item.id" :value="item.id">{{ item.name }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
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
        <NuxtLink to="/profil" class="focus-ring rounded-lg p-1.5 text-white/45 hover:text-white" aria-label="Profil"><UserRound :size="15" /></NuxtLink>
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
