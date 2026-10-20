<script setup lang="ts">
import { Menu, Plus, X } from '@lucide/vue'
import { deriveSidebarPalette, sidebarClassesFor } from '../utils/sidebarBrand'

const mobileOpen = ref(false)
const route = useRoute()
const session = await useSession()
const { scope, organization: activeOrganization } = await useActiveScope()
const scopeModules = await useScopeModules()
const { isEnabled: isModuleEnabled, canUseAtActiveScope } = scopeModules

watch(
  () => route.path,
  () => {
    mobileOpen.value = false
  },
)

const { brand: scopeBrand, logoUrl: scopeLogoUrl } = useScopeBrand(scope)
const activeDepartmentRoles = computed(
  () =>
    activeOrganization.value?.departments.find((item) => item.id === scope.value?.departmentId)
      ?.roles ?? [],
)
const topRoleLabel = computed(() => {
  const role = activeOrganization.value?.organizationRoles[0] ?? activeDepartmentRoles.value[0]
  return role ? (roleLabels[role] ?? role) : ''
})

const sidebarPalette = computed(() =>
  deriveSidebarPalette(scopeBrand.value.primaryColor, scopeBrand.value.accentColor),
)
const sidebarStyle = computed(() => ({
  backgroundColor: sidebarPalette.value.surface,
  color: sidebarPalette.value.onSurface,
}))
const accentStyle = computed(() => ({
  backgroundColor: sidebarPalette.value.actionSurface,
  color: sidebarPalette.value.onAction,
}))
const sidebarClasses = computed(() => sidebarClassesFor(sidebarPalette.value))

const { navigation, moduleGroups, organizationNavigation, moduleManagementGroups } = useShellNavigation(scope, scopeModules)
</script>

<template>
  <!--
    Authenticated session and scope data are intentionally only available in the browser.
    Rendering the shell on the server would therefore produce an empty sidebar and page,
    which differs from the first client render and causes Vue hydration mismatches.
  -->
  <ClientOnly>
    <div class="min-h-screen bg-oat lg:flex lg:h-screen lg:overflow-hidden">
      <header
        class="sticky top-0 z-40 flex h-16 items-center justify-between px-4 lg:hidden"
        :style="sidebarStyle"
      >
        <AppLogo :text-class="sidebarClasses.text" />
        <button
          class="focus-ring rounded-lg p-2"
          :class="sidebarClasses.text"
          aria-label="Navigation öffnen"
          @click="mobileOpen = !mobileOpen"
        >
          <X v-if="mobileOpen" :size="22" />
          <Menu v-else :size="22" />
        </button>
      </header>

      <div
        v-if="mobileOpen"
        class="fixed inset-0 z-30 bg-ink/40 backdrop-blur-sm lg:hidden"
        @click="mobileOpen = false"
      />
      <aside
        class="fixed bottom-0 left-0 top-0 z-30 flex w-[268px] flex-col overflow-y-auto px-4 py-5 transition-transform duration-200 lg:sticky lg:h-screen lg:min-h-0 lg:translate-x-0"
        :class="mobileOpen ? 'translate-x-0 pt-20' : '-translate-x-full'"
        :style="sidebarStyle"
      >
        <div class="hidden px-2 pb-7 lg:block"><AppLogo :text-class="sidebarClasses.text" /></div>

        <SidebarScopeSwitcher
          v-if="activeOrganization"
          v-model:scope="scope"
          v-model:logo-url="scopeLogoUrl"
          :organizations="session?.scopes ?? []"
          :organization="activeOrganization"
          :classes="sidebarClasses"
          :accent-style="accentStyle"
        />

        <NuxtLink
          v-if="isModuleEnabled('social_media') && canUseAtActiveScope('post.create')"
          to="/erstellen"
          class="focus-ring mb-6 flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold transition hover:-translate-y-0.5"
          :style="accentStyle"
        >
          <Plus :size="17" stroke-width="2.5" /> Beitrag erstellen
        </NuxtLink>

        <SidebarNavSection :items="navigation" label="Hauptnavigation" :classes="sidebarClasses" />
        <SidebarNavSection
          v-for="group in moduleGroups"
          :key="group.key"
          :heading="group.label"
          :label="group.label"
          :items="group.navigation"
          :classes="sidebarClasses"
        />
        <SidebarNavSection
          v-if="organizationNavigation.length > 0"
          heading="Verein verwalten"
          label="Vereinsverwaltung"
          :items="organizationNavigation"
          :classes="sidebarClasses"
        />
        <SidebarNavSection
          v-for="group in moduleManagementGroups"
          :key="`manage-${group.key}`"
          :heading="`${group.label} verwalten`"
          :label="`${group.label} verwalten`"
          :items="group.managementNavigation"
          :classes="sidebarClasses"
        />

        <SidebarUserFooter
          :display-name="session?.displayName ?? ''"
          :role-label="topRoleLabel"
          :classes="sidebarClasses"
          show-profile-link
        />
      </aside>

      <!-- relative: absolut positionierte Inhalte (sr-only, versteckte Datei-Inputs) muessen in
           main bleiben; sonst verlaengern sie das Dokument und die Shell scrollt als Ganzes. -->
      <main class="relative min-w-0 flex-1 lg:h-screen lg:min-h-0 lg:overflow-y-auto">
        <div
          class="mx-auto w-full px-5 py-8 sm:px-10"
          :class="route.path === '/bildstil' ? 'max-w-[1800px] lg:px-6' : 'max-w-[1280px]'"
        >
          <slot />
        </div>
      </main>
      <PageSaveFab />
    </div>
    <template #fallback>
      <main
        class="grid min-h-screen place-items-center bg-oat px-5 text-sm text-[#7b827d]"
        aria-busy="true"
      >
        Anwendung wird geladen …
      </main>
    </template>
  </ClientOnly>
</template>
