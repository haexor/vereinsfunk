<script setup lang="ts">
import { Lock, Pencil, Plus, Trash2 } from '@lucide/vue'
import { PlayerboardCategorySchema, type PlayerboardCategory, type ScopeLevel } from '@vereinsfunk/contracts'
import { playerboardErrorMessage } from '../../utils/playerboardErrors'

// Paket 052, PR 3: Punktekategorien je Ebene. Eine Ebene sieht ihre eigenen und die geerbten
// Kategorien; geerbte sind hier schreibgeschuetzt und nennen ihre Herkunft. Kategorien mit Punkten
// werden nicht geloescht, sondern deaktiviert.
const api = useApiClient()
const { levels } = await usePlayerboardTeam()

const selectedScope = ref<ScopeLevel>(levels.value.at(-1)?.scope ?? 'organization')
watch(levels, (list) => {
  if (!list.some((level) => level.scope === selectedScope.value)) selectedScope.value = list.at(-1)?.scope ?? 'organization'
})
const level = computed(() => levels.value.find((item) => item.scope === selectedScope.value) ?? null)
const canEditLevel = computed(() => (level.value ? useCan('playerboard.manage', level.value.permissionScope) : false))

const categories = ref<PlayerboardCategory[]>([])
const loading = ref(false)
const errorMessage = ref('')
const actionError = ref('')
const loadGeneration = ref(0)
const mutationGeneration = ref(0)

async function load() {
  const generation = ++loadGeneration.value
  const requested = level.value
  categories.value = []
  errorMessage.value = ''
  if (!requested) {
    loading.value = false
    return
  }
  const isCurrent = () => generation === loadGeneration.value
    && level.value?.scope === requested.scope
    && level.value?.scopeId === requested.scopeId
  loading.value = true
  try {
    const result = await api.request('/v1/playerboard/categories', { query: { scope: requested.scope, scopeId: requested.scopeId } }, PlayerboardCategorySchema.array())
    if (isCurrent()) categories.value = result
  } catch (error) {
    if (isCurrent()) errorMessage.value = playerboardErrorMessage(error, 'Die Kategorien konnten nicht geladen werden.')
  } finally {
    if (isCurrent()) loading.value = false
  }
}
await load()

const inherited = computed(() => categories.value.filter((category) => category.inherited))
const own = computed(() => categories.value.filter((category) => !category.inherited))
const originLabels: Record<ScopeLevel, string> = { organization: 'vom Verein', department: 'von der Abteilung', team: 'von der Mannschaft' }

// --- Anlegen und bearbeiten --------------------------------------------------------------------

const createForm = reactive({ name: '', valueMin: '0', valueMax: '10' })
const creating = ref(false)

async function create() {
  const requested = level.value
  if (!requested) return
  const generation = mutationGeneration.value
  const isCurrent = () => generation === mutationGeneration.value
    && level.value?.scope === requested.scope
    && level.value?.scopeId === requested.scopeId
  creating.value = true
  actionError.value = ''
  try {
    const created = await api.request('/v1/playerboard/categories', {
      method: 'POST',
      body: {
        scope: requested.scope, scopeId: requested.scopeId, name: createForm.name.trim(),
        valueMin: Number(createForm.valueMin), valueMax: Number(createForm.valueMax), sortOrder: own.value.length * 10,
      },
    }, PlayerboardCategorySchema)
    if (isCurrent()) {
      categories.value = [...categories.value, created]
      createForm.name = ''
    }
  } catch (error) {
    if (isCurrent()) actionError.value = playerboardErrorMessage(error, 'Die Kategorie konnte nicht angelegt werden.')
  } finally {
    if (isCurrent()) creating.value = false
  }
}

const editingId = ref<string | null>(null)
const editForm = reactive({ name: '', valueMin: '', valueMax: '' })
const busyId = ref<string | null>(null)

function startEdit(category: PlayerboardCategory) {
  editingId.value = category.id
  editForm.name = category.name
  editForm.valueMin = String(category.valueMin)
  editForm.valueMax = String(category.valueMax)
  actionError.value = ''
}

async function update(category: PlayerboardCategory, body: Record<string, unknown>) {
  const requested = level.value
  if (!requested) return false
  const generation = mutationGeneration.value
  const isCurrent = () => generation === mutationGeneration.value
    && level.value?.scope === requested.scope
    && level.value?.scopeId === requested.scopeId
  busyId.value = category.id
  actionError.value = ''
  try {
    const updated = await api.request(`/v1/playerboard/categories/${category.id}`, { method: 'PATCH', body }, PlayerboardCategorySchema)
    if (!isCurrent()) return false
    categories.value = categories.value.map((item) => (item.id === updated.id ? updated : item))
    return true
  } catch (error) {
    if (isCurrent()) actionError.value = playerboardErrorMessage(error, 'Die Kategorie konnte nicht gespeichert werden.')
    return false
  } finally {
    if (isCurrent()) busyId.value = null
  }
}

async function toggleActive(category: PlayerboardCategory, event: Event) {
  const input = event.target as HTMLInputElement
  const saved = await update(category, { active: input.checked })
  if (!saved) input.checked = category.active
}

async function saveEdit(category: PlayerboardCategory) {
  const saved = await update(category, { name: editForm.name.trim(), valueMin: Number(editForm.valueMin), valueMax: Number(editForm.valueMax) })
  if (saved) editingId.value = null
}

async function remove(category: PlayerboardCategory) {
  if (!window.confirm(`Kategorie „${category.name}“ löschen?`)) return
  const requested = level.value
  if (!requested) return
  const generation = mutationGeneration.value
  const isCurrent = () => generation === mutationGeneration.value
    && level.value?.scope === requested.scope
    && level.value?.scopeId === requested.scopeId
  busyId.value = category.id
  actionError.value = ''
  try {
    await api.request(`/v1/playerboard/categories/${category.id}`, { method: 'DELETE' })
    if (isCurrent()) categories.value = categories.value.filter((item) => item.id !== category.id)
  } catch (error) {
    if (isCurrent()) actionError.value = playerboardErrorMessage(error, 'Die Kategorie konnte nicht gelöscht werden.')
  } finally {
    if (isCurrent()) busyId.value = null
  }
}

watch(() => level.value && `${level.value.scope}:${level.value.scopeId}`, () => {
  loadGeneration.value += 1
  mutationGeneration.value += 1
  editingId.value = null
  creating.value = false
  busyId.value = null
  void load()
})

const inputClass = 'focus-ring h-11 w-full rounded-xl border border-[#dfe0d9] bg-white px-3 text-sm text-ink'
const labelClass = 'grid gap-1.5 text-xs font-semibold text-[#5b625d]'
</script>

<template>
  <div>
    <header class="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        <div class="eyebrow mb-3">PlayerBoard verwalten</div>
        <h1 class="font-display text-3xl font-extrabold tracking-[-.045em] text-ink">Kategorien</h1>
        <p class="mt-2 max-w-2xl text-sm text-[#6c756f]">Wofür es im Training Punkte gibt. Kategorien des Vereins und der Abteilung gelten für alle Mannschaften darunter; eine Mannschaft kann eigene ergänzen, wenn das oben erlaubt ist.</p>
      </div>
      <PlayerboardTeamPicker />
    </header>

    <PlayerboardLevelTabs v-model="selectedScope" :levels="levels" />

    <p v-if="actionError" class="mb-4 text-sm font-semibold text-amber-800" role="alert">{{ actionError }}</p>
    <p v-if="loading" class="text-xs text-[#7b827d]">Wird geladen …</p>
    <p v-else-if="errorMessage" class="text-sm text-amber-800">{{ errorMessage }}</p>
    <div v-else-if="level" :id="`playerboard-level-panel-${level.scope}`" role="tabpanel" :aria-labelledby="`playerboard-level-tab-${level.scope}`" tabindex="0">
      <section v-if="inherited.length > 0" class="mb-6" aria-labelledby="inherited-heading">
        <h2 id="inherited-heading" class="mb-2 text-[11px] font-bold uppercase tracking-[.12em] text-[#7b827d]">Geerbt</h2>
        <ul class="card divide-y divide-[#ecece5]">
          <li v-for="category in inherited" :key="category.id" class="flex min-h-14 flex-wrap items-center gap-3 px-4 py-2" :class="category.effective ? '' : 'opacity-60'">
            <Lock :size="15" class="shrink-0 text-[#9aa096]" aria-hidden="true" />
            <span class="min-w-0 flex-1">
              <span class="block text-sm font-semibold text-ink">{{ category.name }}</span>
              <span class="block text-xs text-[#6c756f]">{{ category.valueMin }}–{{ category.valueMax }} · {{ originLabels[category.scope] }}<template v-if="!category.active"> · deaktiviert</template></span>
            </span>
          </li>
        </ul>
      </section>

      <section class="mb-6" aria-labelledby="own-heading">
        <h2 id="own-heading" class="mb-2 text-[11px] font-bold uppercase tracking-[.12em] text-[#7b827d]">{{ level.label }} {{ level.name }}</h2>
        <p v-if="own.length === 0" class="card p-5 text-sm text-[#6c756f]">Auf dieser Ebene gibt es noch keine eigene Kategorie.</p>
        <ul v-else class="card divide-y divide-[#ecece5]">
          <li v-for="category in own" :key="category.id" class="px-4 py-2">
            <div class="flex min-h-12 flex-wrap items-center gap-3">
              <span class="min-w-0 flex-1" :class="category.active ? '' : 'opacity-60'">
                <span class="block text-sm font-semibold text-ink">{{ category.name }}</span>
                <span class="block text-xs text-[#6c756f]">
                  {{ category.valueMin }}–{{ category.valueMax }}<template v-if="!category.active"> · deaktiviert</template><template v-else-if="!category.effective"> · gilt hier nicht (Mannschaftskategorien sind oben nicht erlaubt)</template>
                </span>
              </span>
              <template v-if="category.canEdit">
                <label class="flex min-h-11 cursor-pointer items-center gap-2 text-xs font-semibold text-ink">
                  <input type="checkbox" class="h-5 w-5 accent-forest" :checked="category.active" :disabled="busyId !== null" @change="toggleActive(category, $event)" /> aktiv
                </label>
                <button type="button" class="focus-ring grid min-h-11 w-11 place-items-center rounded-xl border border-[#dfe0d9] text-ink" :aria-label="`${category.name} bearbeiten`" @click="startEdit(category)"><Pencil :size="15" /></button>
                <button type="button" class="focus-ring grid min-h-11 w-11 place-items-center rounded-xl border border-[#dfe0d9] text-[#8a4b3c] disabled:opacity-60" :disabled="busyId !== null" :aria-label="`${category.name} löschen`" @click="remove(category)"><Trash2 :size="15" /></button>
              </template>
            </div>
            <form v-if="editingId === category.id" class="mt-2 grid gap-3 pb-2 sm:grid-cols-4" @submit.prevent="saveEdit(category)">
              <label :class="[labelClass, 'sm:col-span-2']">Name<input v-model="editForm.name" required maxlength="60" :class="inputClass" /></label>
              <label :class="labelClass">Von<input v-model="editForm.valueMin" type="number" inputmode="numeric" required min="-1000" max="1000" :class="inputClass" /></label>
              <label :class="labelClass">Bis<input v-model="editForm.valueMax" type="number" inputmode="numeric" required min="-1000" max="1000" :class="inputClass" /></label>
              <div class="flex gap-2 sm:col-span-4">
                <button type="submit" class="focus-ring min-h-11 rounded-xl bg-forest px-5 text-xs font-bold text-white disabled:opacity-60" :disabled="busyId !== null">Speichern</button>
                <button type="button" class="focus-ring min-h-11 rounded-xl border border-[#dfe0d9] px-5 text-xs font-semibold text-ink" @click="editingId = null">Abbrechen</button>
              </div>
            </form>
          </li>
        </ul>
      </section>

      <section v-if="canEditLevel" class="card p-4 sm:p-5" aria-labelledby="create-heading">
        <h2 id="create-heading" class="mb-3 font-display text-base font-bold text-ink">Kategorie anlegen</h2>
        <form class="grid gap-3 sm:grid-cols-5" @submit.prevent="create">
          <label :class="[labelClass, 'sm:col-span-2']">Name<input v-model="createForm.name" required maxlength="60" placeholder="z. B. Einsatz" :class="inputClass" /></label>
          <label :class="labelClass">Von<input v-model="createForm.valueMin" type="number" inputmode="numeric" required min="-1000" max="1000" :class="inputClass" /></label>
          <label :class="labelClass">Bis<input v-model="createForm.valueMax" type="number" inputmode="numeric" required min="-1000" max="1000" :class="inputClass" /></label>
          <div class="flex items-end">
            <button type="submit" class="focus-ring inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-forest px-4 text-xs font-bold text-white disabled:opacity-60" :disabled="creating || Number(createForm.valueMin) >= Number(createForm.valueMax)">
              <Plus :size="15" /> Anlegen
            </button>
          </div>
        </form>
      </section>
    </div>
  </div>
</template>
