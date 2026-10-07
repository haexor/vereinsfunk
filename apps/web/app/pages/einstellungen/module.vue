<script setup lang="ts">
import { Blocks } from '@lucide/vue'
import { ScopeModulesSchema, UpdateScopeModulesRequestSchema, type AppModule, type ScopeModules } from '@vereinsfunk/contracts'
import { appModuleOrder, appModuleRegistry, blockedByLabel, moduleToggleState, nextModuleSelection, type ModuleToggleState } from '../../modules/registry'
import { ApiRequestError } from '../../utils/apiClient'

// Paket 051, PR 3: welche Module auf welcher Ebene wirken. Eine Ebene kann nur abwaehlen, was oben
// aktiv ist; die drei Zustaende folgen PolicyFlagToggles.vue (geerbt / abgewaehlt / gesperrt).
// Jedes Mitglied sieht die Auswahl, aendern kann nur, wer die Ebene verwalten darf (canEdit).
const api = useApiClient()
const { entries, refresh } = await useScopeModules()

const pendingKey = ref<string | null>(null)
const errorMessage = ref('')
const blockingPublicationCount = ref(0)

const organizationEntry = computed(() => entries.value?.find((entry) => entry.scope === 'organization') ?? null)
const departmentGroups = computed(() =>
  (entries.value ?? [])
    .filter((entry) => entry.scope === 'department')
    .map((department) => ({
      department,
      teams: (entries.value ?? []).filter((entry) => entry.scope === 'team' && entry.departmentId === department.scopeId),
    })),
)

const stateLabels: Record<ModuleToggleState, string> = {
  inherited: 'aktiv (geerbt)',
  selected: 'aktiv',
  deselected: 'abgewählt',
  locked: 'gesperrt',
}

function stateClass(state: ModuleToggleState): string {
  if (state === 'deselected') return 'bg-amber-100 text-amber-800'
  if (state === 'locked') return 'bg-[#eef1ea] text-[#9aa096]'
  return 'bg-[#e4f1e7] text-forest'
}

async function save(entry: ScopeModules, enabledModules: AppModule[] | null) {
  pendingKey.value = `${entry.scope}:${entry.scopeId}`
  errorMessage.value = ''
  blockingPublicationCount.value = 0
  try {
    const body = UpdateScopeModulesRequestSchema.parse({ scope: entry.scope, scopeId: entry.scopeId, enabledModules })
    await api.request('/v1/scope-modules', { method: 'PUT', body }, ScopeModulesSchema)
    // Eine Aenderung wirkt auf alle Ebenen darunter -- deshalb die ganze Liste neu laden statt nur
    // diesen Eintrag zu ersetzen.
    await refresh()
  } catch (error) {
    const code = error instanceof ApiRequestError ? error.code : ''
    if (code === 'module_has_active_publications') {
      const publications = (error as ApiRequestError).data as { publications?: unknown[] }
      blockingPublicationCount.value = publications.publications?.length ?? 0
      errorMessage.value = 'Social Media kann hier nicht abgeschaltet werden, solange Veröffentlichungen eingeplant sind oder laufen. Brich sie zuerst ab oder warte, bis sie erschienen sind.'
    } else if (code === 'module_not_available') {
      errorMessage.value = 'Dieses Modul ist auf einer höheren Ebene oder im Tarif nicht aktiv und kann hier nicht eingeschaltet werden.'
    } else if (code === 'forbidden') {
      errorMessage.value = 'Du darfst die Module dieser Ebene nicht ändern.'
    } else {
      errorMessage.value = 'Die Modulauswahl konnte nicht gespeichert werden.'
    }
  } finally {
    pendingKey.value = null
  }
}

function toggle(entry: ScopeModules, module: AppModule) {
  const state = moduleToggleState(entry, module)
  if (state === 'locked') return
  void save(entry, nextModuleSelection(entry, module, state === 'deselected'))
}

function resetToInherited(entry: ScopeModules) {
  void save(entry, null)
}
</script>

<template>
  <div>
    <header class="mb-7">
      <div class="eyebrow mb-3">Verein verwalten</div>
      <h1 class="font-display text-3xl font-extrabold tracking-[-.045em] text-ink">Module</h1>
      <p class="mt-2 max-w-2xl text-sm text-[#6c756f]">
        Welche Anwendungen in Verein, Abteilungen und Mannschaften zur Verfügung stehen. Eine Ebene übernimmt die Auswahl von oben und kann Module nur abwählen, nie hinzunehmen. Abschalten blendet ein Modul aus, gelöscht wird nichts.
      </p>
    </header>

    <p v-if="errorMessage" class="card mb-5 p-4 text-sm font-semibold text-amber-800" role="alert">
      {{ errorMessage }}
      <NuxtLink v-if="blockingPublicationCount > 0" to="/beitraege" class="ml-1 underline">{{ blockingPublicationCount }} betroffene Veröffentlichung{{ blockingPublicationCount === 1 ? '' : 'en' }} ansehen</NuxtLink>
    </p>

    <section v-if="entries === null" class="card p-6 text-sm text-[#7b827d]">Die Modulauswahl konnte nicht geladen werden.</section>
    <div v-else class="space-y-5">
      <template v-for="group in [{ department: organizationEntry, teams: [] as ScopeModules[] }, ...departmentGroups]" :key="group.department?.scopeId ?? 'organization'">
        <section v-if="group.department" class="card p-5">
          <div v-for="entry in [group.department, ...group.teams]" :key="`${entry.scope}:${entry.scopeId}`" class="flex flex-col gap-3 border-[#ecece5] py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between [&:not(:first-child)]:border-t" :class="entry.scope === 'team' ? 'sm:pl-6' : ''">
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <Blocks v-if="entry.scope !== 'team'" :size="15" class="shrink-0 text-forest" />
                <span class="truncate text-sm font-semibold text-ink">{{ entry.name }}</span>
                <span class="text-[11px] text-[#9aa096]">{{ entry.scope === 'organization' ? 'Verein' : entry.scope === 'department' ? 'Abteilung' : 'Mannschaft' }}</span>
              </div>
              <button v-if="entry.canEdit && entry.own !== null" type="button" class="focus-ring mt-1 rounded text-[11px] font-semibold text-forest underline disabled:opacity-60" :disabled="pendingKey !== null" @click="resetToInherited(entry)">
                {{ entry.scope === 'organization' ? 'Alle Module des Tarifs übernehmen' : 'Auswahl von oben übernehmen' }}
              </button>
            </div>
            <div class="flex flex-wrap gap-2">
              <template v-for="module in appModuleOrder" :key="module">
                <button
                  v-if="entry.canEdit && moduleToggleState(entry, module) !== 'locked'"
                  type="button"
                  :disabled="pendingKey !== null"
                  :aria-pressed="moduleToggleState(entry, module) !== 'deselected'"
                  :aria-label="`${appModuleRegistry[module].label} für ${entry.name}`"
                  class="focus-ring rounded-full px-3 py-1 text-[11px] font-semibold disabled:opacity-60"
                  :class="stateClass(moduleToggleState(entry, module))"
                  @click="toggle(entry, module)"
                >
                  {{ appModuleRegistry[module].label }}: {{ stateLabels[moduleToggleState(entry, module)] }}
                </button>
                <span v-else class="rounded-full px-3 py-1 text-[11px] font-semibold" :class="stateClass(moduleToggleState(entry, module))" :title="blockedByLabel(entry.modules.find((item) => item.module === module)?.blockedBy ?? null, entry.scope)">
                  {{ appModuleRegistry[module].label }}: {{ stateLabels[moduleToggleState(entry, module)] }}
                  <template v-if="moduleToggleState(entry, module) === 'locked'"> ({{ blockedByLabel(entry.modules.find((item) => item.module === module)?.blockedBy ?? null, entry.scope) }})</template>
                </span>
              </template>
            </div>
          </div>
        </section>
      </template>
    </div>
  </div>
</template>
