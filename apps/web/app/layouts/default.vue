<script setup lang="ts">
import { Plus } from '@lucide/vue'
import { deriveSidebarPalette, sidebarClassesFor } from '../utils/sidebarBrand'

const route = useRoute()
const session = await useSession()
const { scope, organization: activeOrganization } = await useActiveScope()
const scopeModules = await useScopeModules()
const { isEnabled: isModuleEnabled, canUseAtActiveScope } = scopeModules

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
  <AppShell
    :surface-style="sidebarStyle"
    :text-class="sidebarClasses.text"
    :content-class="route.path === '/bildstil' ? 'max-w-[1800px] lg:px-6' : 'max-w-[1280px]'"
  >
    <template #sidebar>
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
    </template>
    <slot />
    <template #overlay><PageSaveFab /></template>
  </AppShell>
</template>
