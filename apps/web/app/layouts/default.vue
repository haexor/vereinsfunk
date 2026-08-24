<script setup lang="ts">
import { BarChart3, BookUser, Building2, CalendarDays, CheckCircle2, CreditCard, Feather, FileSignature, FileText, Frame, LayoutDashboard, LayoutGrid, LogOut, Menu, Palette, Plug, Plus, Scale, Settings, Share2, ShieldCheck, Users, UserRound, UserSearch, X } from '@lucide/vue'
import { deriveSidebarPalette } from '../utils/sidebarBrand'
import { resolveSidebarLogoAsset, type SidebarLogoAsset } from '../utils/sidebarLogo'

const mobileOpen = ref(false)
const route = useRoute()
const session = await useSession()
const scope = await useScope()

watch(() => route.path, () => { mobileOpen.value = false })

const activeOrganization = computed(() => session.value?.scopes.find((item) => item.organizationId === scope.value?.organizationId) ?? null)
const activeDepartment = computed(() => activeOrganization.value?.departments.find((item) => item.id === scope.value?.departmentId) ?? null)
const activeScopeName = computed(() => activeDepartment.value?.name ?? activeOrganization.value?.organizationName ?? '')
const activeScopeKind = computed(() => activeDepartment.value ? 'Abteilung' : 'Verein')
const scopeInitials = computed(() => activeScopeName.value.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join('').toUpperCase())
const { revision: brandRevision } = useBrandRevision()

// Paket 013, Rueckbau: das Vereinslogo ersetzt die Initialen dort, wo der Verein tatsaechlich
// als Marke auftritt -- diese kleine Kachel im Umschalter, nicht die geteilte AppLogo-Komponente.
// AppLogo bleibt bewusst unveraendert: sie steht auch in layouts/admin.vue und layouts/auth.vue,
// wo es keinen (oder noch keinen einzelnen) aktiven Verein gibt -- dort waere ein Vereinslogo
// fachlich falsch, es ist die Produktmarke "vereinsfunk", nicht die des Vereins.
const scopeLogoUrl = ref('')
const scopeBrand = ref({ primaryColor: '#163a2c', accentColor: '#caff4a' })
// Lauf-ID statt reiner organizationId-Pruefung: bei A -> B -> A stimmt organizationId beim
// dritten Lauf wieder mit dem ersten ueberein, ein spaet zurueckkehrender erster Lauf wuerde die
// Pruefung also bestehen und das (moeglicherweise veraltete) Ergebnis des dritten Laufs
// ueberschreiben. Die Lauf-ID ist bei jedem Watcher-Aufruf eindeutig, unabhaengig vom Zielverein.
let latestScopeBrandRun = 0
watch(
  () => [scope.value?.organizationId, scope.value?.departmentId, brandRevision.value] as const,
  async ([organizationId, departmentId]) => {
    const run = ++latestScopeBrandRun
    scopeLogoUrl.value = ''
    scopeBrand.value = { primaryColor: '#163a2c', accentColor: '#caff4a' }
    if (!organizationId) return
    const supabase = useSupabaseClient()
    const organizationBrand = await supabase
      .from('organization_brand_profiles')
      .select('primary_color, accent_color, logo_asset_id')
      .eq('organization_id', organizationId)
      .maybeSingle()
    if (run !== latestScopeBrandRun || !organizationBrand.data) return
    let brand = {
      primaryColor: organizationBrand.data.primary_color as string,
      accentColor: organizationBrand.data.accent_color as string,
      logoAssetId: organizationBrand.data.logo_asset_id as string | null,
    }
    if (departmentId) {
      const departmentBrand = await supabase
        .from('department_brand_profiles')
        .select('primary_color, accent_color, logo_asset_id')
        .eq('department_id', departmentId)
        .maybeSingle()
      if (run !== latestScopeBrandRun) return
      if (departmentBrand.data) {
        brand = {
          ...brand,
          primaryColor: (departmentBrand.data.primary_color as string | null) ?? brand.primaryColor,
          accentColor: (departmentBrand.data.accent_color as string | null) ?? brand.accentColor,
          logoAssetId: (departmentBrand.data.logo_asset_id as string | null) ?? brand.logoAssetId,
        }
      }
    }
    scopeBrand.value = brand
    // Das aktiv verknuepfte Logo bleibt die erste Wahl. Wurde eine passende Logo-Datei bereits
    // hochgeladen, aber auf /marke noch nicht als Render-Logo gespeichert, zeigt die Shell sie
    // trotzdem als Identitaet des aktuellen Bereichs. So bleibt der Kontext eindeutig, ohne die
    // fachliche, explizite Verknuepfung fuer Beitraege zu veraendern.
    const logoAssets = await supabase
      .from('brand_assets')
      .select('id, department_id, team_id, kind, object_path, status')
      .eq('organization_id', organizationId)
      .eq('status', 'ready')
      .in('kind', ['logo_primary', 'logo_light', 'logo_dark', 'logo_mark'])
      .order('created_at', { ascending: false })
    if (run !== latestScopeBrandRun || logoAssets.error || !logoAssets.data) return
    const asset = resolveSidebarLogoAsset(
      logoAssets.data.map((item) => ({
        id: item.id as string,
        departmentId: item.department_id as string | null,
        teamId: item.team_id as string | null,
        kind: item.kind as string,
        objectPath: item.object_path as string,
        status: item.status as string,
      } satisfies SidebarLogoAsset)),
      departmentId ?? null,
      brand.logoAssetId,
    )
    if (!asset) return
    const signed = await supabase.storage.from('brand-assets').createSignedUrl(asset.objectPath, 600)
    if (run !== latestScopeBrandRun) return
    scopeLogoUrl.value = signed.data?.signedUrl ?? ''
  },
  { immediate: true },
)
const activeDepartmentRoles = computed(() => activeOrganization.value?.departments.find((item) => item.id === scope.value?.departmentId)?.roles ?? [])
const topRoleLabel = computed(() => {
  const role = activeOrganization.value?.organizationRoles[0] ?? activeDepartmentRoles.value[0]
  return role ? roleLabels[role] ?? role : ''
})
const userInitials = computed(() => (session.value?.displayName ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join('').toUpperCase())

function selectOrganization(organizationId: string) {
  const organization = session.value?.scopes.find((item) => item.organizationId === organizationId)
  if (organization) scope.value = { organizationId, departmentId: null }
}

const scopeSelection = computed({
  get: () => scope.value?.departmentId ? `department:${scope.value.departmentId}` : 'organization',
  set: (value: string) => {
    if (!scope.value) return
    scope.value = {
      ...scope.value,
      departmentId: value === 'organization' ? null : value.replace(/^department:/, ''),
    }
  },
})

const sidebarPalette = computed(() => deriveSidebarPalette(scopeBrand.value.primaryColor, scopeBrand.value.accentColor))
const sidebarStyle = computed(() => ({ backgroundColor: sidebarPalette.value.surface, color: sidebarPalette.value.onSurface }))
const accentStyle = computed(() => ({ backgroundColor: sidebarPalette.value.actionSurface, color: sidebarPalette.value.onAction }))
const sidebarClasses = computed(() =>
  sidebarPalette.value.onSurface === '#ffffff'
    ? {
        text: 'text-white', muted: 'text-white', quiet: 'text-white', panel: 'border-white/30 bg-white/[.06]', divider: 'bg-white/30',
        select: 'text-white [&_svg]:text-white', nav: 'text-white hover:bg-white/[.07]', activeNav: '!bg-white/[.11] !text-white', footer: 'border-white/30',
      }
    : {
        text: 'text-ink', muted: 'text-ink', quiet: 'text-ink', panel: 'border-ink/30 bg-ink/[.05]', divider: 'bg-ink/30',
        select: 'text-ink [&_svg]:text-ink', nav: 'text-ink hover:bg-ink/[.07]', activeNav: '!bg-ink/[.11] !text-ink', footer: 'border-ink/30',
      },
)

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
const organizationNav: { label: string; to: string; icon: typeof LayoutDashboard; organizationOnly?: boolean }[] = [
  { label: 'Marke', to: '/marke', icon: Palette },
  { label: 'Bildstil', to: '/bildstil', icon: Frame },
  { label: 'Bildkomposition', to: '/bildkomposition', icon: LayoutGrid },
  { label: 'Stilprofile', to: '/stilprofile', icon: Feather },
  { label: 'Textbausteine', to: '/textbausteine', icon: FileSignature },
  { label: 'Struktur', to: '/struktur', icon: Building2 },
  { label: 'Mitglieder', to: '/mitglieder', icon: Users },
  { label: 'Verzeichnis', to: '/verzeichnis', icon: BookUser },
  { label: 'Einwilligungen', to: '/einwilligungen', icon: ShieldCheck },
  { label: 'Kanäle', to: '/kanaele', icon: Share2 },
  { label: 'Integrationen', to: '/integrationen', icon: Plug },
  { label: 'Einstellungen', to: '/einstellungen', icon: Settings },
  { label: 'Tarif', to: '/einstellungen/tarif', icon: CreditCard, organizationOnly: true },
  { label: 'Recht & Datenschutz', to: '/einstellungen/recht', icon: Scale, organizationOnly: true },
  { label: 'Betroffenenanfragen', to: '/datenschutz/anfragen', icon: UserSearch, organizationOnly: true },
]
const visibleOrganizationNav = computed(() => organizationNav.filter((item) => !item.organizationOnly || !scope.value?.departmentId))
const organizationOnlyRoutes = new Set(organizationNav.filter((item) => item.organizationOnly).map((item) => item.to))

// Vereinsweite Vertrags- und Datenschutzthemen dürfen nicht im Arbeitsbereich einer
// Abteilung offen bleiben, auch nicht über einen alten Tab oder einen Direktlink.
watch(
  () => [scope.value?.departmentId, route.path] as const,
  ([departmentId, path]) => {
    if (departmentId && organizationOnlyRoutes.has(path)) void navigateTo('/')
  },
  { immediate: true },
)
</script>

<template>
  <!--
    Authenticated session and scope data are intentionally only available in the browser.
    Rendering the shell on the server would therefore produce an empty sidebar and page,
    which differs from the first client render and causes Vue hydration mismatches.
  -->
  <ClientOnly>
  <div class="min-h-screen bg-oat lg:flex lg:h-screen lg:overflow-hidden">
    <header class="sticky top-0 z-40 flex h-16 items-center justify-between px-4 lg:hidden" :style="sidebarStyle">
      <AppLogo :text-class="sidebarClasses.text" />
      <button class="focus-ring rounded-lg p-2" :class="sidebarClasses.text" aria-label="Navigation öffnen" @click="mobileOpen = !mobileOpen">
        <X v-if="mobileOpen" :size="22" />
        <Menu v-else :size="22" />
      </button>
    </header>

    <div v-if="mobileOpen" class="fixed inset-0 z-30 bg-ink/40 backdrop-blur-sm lg:hidden" @click="mobileOpen = false" />
    <aside
      class="fixed bottom-0 left-0 top-0 z-30 flex w-[268px] flex-col overflow-y-auto px-4 py-5 transition-transform duration-200 lg:sticky lg:h-screen lg:min-h-0 lg:translate-x-0"
      :class="mobileOpen ? 'translate-x-0 pt-20' : '-translate-x-full'"
      :style="sidebarStyle"
    >
      <div class="hidden px-2 pb-7 lg:block"><AppLogo :text-class="sidebarClasses.text" /></div>

      <div v-if="activeOrganization" class="mb-5 rounded-2xl border p-2" :class="sidebarClasses.panel">
        <div class="flex w-full items-center gap-3 p-2 text-left">
          <img v-if="scopeLogoUrl" :src="scopeLogoUrl" :alt="`${activeScopeName} Logo`" class="h-10 w-10 shrink-0 rounded-xl border border-black/5 bg-white p-1.5 shadow-sm" @error="scopeLogoUrl = ''" />
          <span v-else class="grid h-9 w-9 shrink-0 place-items-center rounded-xl font-display text-sm font-extrabold" :style="accentStyle">{{ scopeInitials }}</span>
          <span v-if="(session?.scopes.length ?? 0) <= 1" class="min-w-0 flex-1">
            <span class="block truncate text-sm font-semibold">{{ activeScopeName }}</span>
            <span class="block text-[11px]" :class="sidebarClasses.muted">{{ activeScopeKind }}</span>
          </span>
          <div v-else class="relative block min-w-0 flex-1">
            <Select :model-value="scope?.organizationId ?? ''" @update:model-value="(value: unknown) => selectOrganization(value as string)">
              <SelectTrigger aria-label="Verein auswählen" class="border-0 py-1 pr-6 pl-0 text-sm font-semibold" :class="sidebarClasses.select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="item in session?.scopes" :key="item.organizationId" :value="item.organizationId">{{ item.organizationName }}</SelectItem>
              </SelectContent>
            </Select>
            <span class="block text-[11px]" :class="sidebarClasses.muted">{{ activeScopeKind }}</span>
          </div>
        </div>
        <template v-if="activeOrganization.departments.length">
          <div class="mx-2 my-1 h-px" :class="sidebarClasses.divider" />
          <div class="relative block">
            <p class="px-2 pt-2 text-[10px] font-bold uppercase tracking-[.12em]" :class="sidebarClasses.quiet">Arbeitsbereich</p>
            <Select v-model="scopeSelection">
              <SelectTrigger aria-label="Verein oder Abteilung auswählen" class="border-0 py-2 pr-8 pl-2 text-xs font-medium" :class="sidebarClasses.select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="organization">{{ activeOrganization.organizationName }} · Verein</SelectItem>
                <SelectItem v-for="item in activeOrganization.departments" :key="item.id" :value="`department:${item.id}`">{{ item.name }} · Abteilung</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </template>
      </div>

      <NuxtLink to="/erstellen" class="focus-ring mb-6 flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold transition hover:-translate-y-0.5" :style="accentStyle">
        <Plus :size="17" stroke-width="2.5" /> Beitrag erstellen
      </NuxtLink>

      <nav class="space-y-1" aria-label="Hauptnavigation">
        <NuxtLink v-for="item in navigation" :key="item.to" :to="item.to" class="focus-ring group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition" :class="sidebarClasses.nav" :active-class="sidebarClasses.activeNav">
          <component :is="item.icon" :size="17" />
          <span class="flex-1">{{ item.label }}</span>
          <span v-if="item.badge" class="grid h-5 min-w-5 place-items-center rounded-full bg-coral px-1 text-[10px] font-bold text-ink">{{ item.badge }}</span>
        </NuxtLink>
      </nav>

      <div class="mb-2 mt-7 px-3 text-[10px] font-bold uppercase tracking-[.14em]" :class="sidebarClasses.quiet">Verein verwalten</div>
      <nav class="space-y-1" aria-label="Vereinsverwaltung">
        <NuxtLink v-for="item in visibleOrganizationNav" :key="item.to" :to="item.to" class="focus-ring flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition" :class="sidebarClasses.nav" :active-class="sidebarClasses.activeNav">
          <component :is="item.icon" :size="17" />{{ item.label }}
        </NuxtLink>
      </nav>

      <div class="mt-auto flex items-center gap-3 border-t px-2 pt-4" :class="sidebarClasses.footer">
        <span class="grid h-9 w-9 place-items-center rounded-full bg-[#d2c7ff] text-xs font-bold text-[#3c3260]">{{ userInitials }}</span>
        <span class="min-w-0 flex-1"><span class="block truncate text-xs font-semibold">{{ session?.displayName }}</span><span class="block text-[10px]" :class="sidebarClasses.quiet">{{ topRoleLabel }}</span></span>
        <NuxtLink to="/profil" class="focus-ring rounded-lg p-1.5" :class="sidebarClasses.muted" aria-label="Profil"><UserRound :size="15" /></NuxtLink>
        <button class="focus-ring rounded-lg p-1.5" :class="sidebarClasses.muted" aria-label="Abmelden" @click="logout"><LogOut :size="15" /></button>
      </div>
    </aside>

    <main class="min-w-0 flex-1 lg:h-screen lg:min-h-0 lg:overflow-y-auto">
      <div class="mx-auto w-full max-w-[1280px] px-5 py-8 sm:px-10"><slot /></div>
    </main>
    <PageSaveFab />
  </div>
    <template #fallback>
      <main class="grid min-h-screen place-items-center bg-oat px-5 text-sm text-[#7b827d]" aria-busy="true">
        Anwendung wird geladen …
      </main>
    </template>
  </ClientOnly>
</template>
