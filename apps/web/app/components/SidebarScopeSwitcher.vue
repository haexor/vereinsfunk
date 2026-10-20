<script setup lang="ts">
import type { ActiveScope } from '../composables/useScope'
import type { SessionScope } from '../composables/useSession'
import { initialsOf } from '../utils/initials'
import type { SidebarClasses } from '../utils/sidebarBrand'

const props = defineProps<{
  organizations: readonly SessionScope[]
  organization: SessionScope
  classes: SidebarClasses
  accentStyle: { backgroundColor: string; color: string }
}>()
const scope = defineModel<ActiveScope | null>('scope', { required: true })
// Laedt das Logo nicht, faellt die Kachel auf die Initialen zurueck.
const logoUrl = defineModel<string>('logoUrl', { required: true })

const activeDepartment = computed(
  () => props.organization.departments.find((item) => item.id === scope.value?.departmentId) ?? null,
)
const activeScopeName = computed(() => activeDepartment.value?.name ?? props.organization.organizationName)
const activeScopeKind = computed(() => (activeDepartment.value ? 'Abteilung' : 'Verein'))
const scopeInitials = computed(() => initialsOf(activeScopeName.value))

function selectOrganization(organizationId: string) {
  const organization = props.organizations.find((item) => item.organizationId === organizationId)
  if (organization) scope.value = { organizationId, departmentId: null }
}

const scopeSelection = computed({
  get: () =>
    scope.value?.departmentId ? `department:${scope.value.departmentId}` : 'organization',
  set: (value: string) => {
    if (!scope.value) return
    scope.value = {
      ...scope.value,
      departmentId: value === 'organization' ? null : value.replace(/^department:/, ''),
    }
  },
})
</script>

<template>
  <div class="mb-5 rounded-2xl border p-2" :class="classes.panel">
    <div class="flex w-full items-center gap-3 p-2 text-left">
      <img
        v-if="logoUrl"
        :src="logoUrl"
        :alt="`${activeScopeName} Logo`"
        class="h-10 w-10 shrink-0 rounded-xl border border-black/5 bg-white p-1.5 shadow-sm"
        @error="logoUrl = ''"
      />
      <span
        v-else
        class="grid h-9 w-9 shrink-0 place-items-center rounded-xl font-display text-sm font-extrabold"
        :style="accentStyle"
        >{{ scopeInitials }}</span
      >
      <span v-if="organizations.length <= 1" class="min-w-0 flex-1">
        <span class="block truncate text-sm font-semibold">{{ activeScopeName }}</span>
        <span class="block text-[11px]" :class="classes.muted">{{ activeScopeKind }}</span>
      </span>
      <div v-else class="relative block min-w-0 flex-1">
        <Select
          :model-value="scope?.organizationId ?? ''"
          @update:model-value="(value: unknown) => selectOrganization(value as string)"
        >
          <SelectTrigger
            aria-label="Verein auswählen"
            class="border-0 py-1 pr-6 pl-0 text-sm font-semibold"
            :class="classes.select"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem
              v-for="item in organizations"
              :key="item.organizationId"
              :value="item.organizationId"
              >{{ item.organizationName }}</SelectItem
            >
          </SelectContent>
        </Select>
        <span class="block text-[11px]" :class="classes.muted">{{ activeScopeKind }}</span>
      </div>
    </div>
    <template v-if="organization.departments.length">
      <div class="mx-2 my-1 h-px" :class="classes.divider" />
      <div class="relative block">
        <p
          class="px-2 pt-2 text-[10px] font-bold uppercase tracking-[.12em]"
          :class="classes.quiet"
        >
          Arbeitsbereich
        </p>
        <Select v-model="scopeSelection">
          <SelectTrigger
            aria-label="Verein oder Abteilung auswählen"
            class="border-0 py-2 pr-8 pl-2 text-xs font-medium"
            :class="classes.select"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="organization"
              >{{ organization.organizationName }} · Verein</SelectItem
            >
            <SelectItem
              v-for="item in organization.departments"
              :key="item.id"
              :value="`department:${item.id}`"
              >{{ item.name }} · Abteilung</SelectItem
            >
          </SelectContent>
        </Select>
      </div>
    </template>
  </div>
</template>
