<script setup lang="ts">
import { CreateContentSignatureBlockRequestSchema, ContentSignatureBlockSchema, UpdateContentSignatureBlockRequestSchema, type ContentSignatureBlock } from '@vereinsfunk/contracts'
import { z } from 'zod'
import { emptyContentSignatureBlockDraft, type ContentSignatureBlockDraft } from '../utils/contentSignatureBlockDraft'

interface DepartmentRow { id: string; name: string }

const api = useApiClient()
const session = await useSession()
const scope = await useScope()
const supabase = useSupabaseClient()
const organizationId = computed(() => scope.value?.organizationId ?? null)
const activeOrganization = computed(() => session.value?.scopes.find((item) => item.organizationId === organizationId.value) ?? null)

const loading = ref(true)
const loadError = ref(false)
const saving = ref(false)

const departments = ref<DepartmentRow[]>([])
const blocks = ref<ContentSignatureBlock[]>([])

// Kein Mannschafts-Level (nicht angefragt, "Einfachheit zuerst") -- nur Verein und Abteilung.
const activeDepartmentId = ref<string | null>(null)

function selectScope(departmentId: string | null) {
  activeDepartmentId.value = departmentId
  createError.value = ''
  deleteError.value = ''
}

const canManageActiveLevel = computed(() => {
  if (!organizationId.value) return false
  return useCan('post.create', { organizationId: organizationId.value, departmentId: activeDepartmentId.value ?? undefined })
})

// "Erben, bis die Ebene einen eigenen Baustein anlegt" (wie Bildstil-Presets): vereinsweite
// Bausteine sind ueberall sichtbar, ein Abteilungs-Baustein nur dort.
const visibleBlocks = computed(() => blocks.value.filter((block) => block.departmentId === null || block.departmentId === activeDepartmentId.value))
const ownBlocks = computed(() => visibleBlocks.value.filter((block) => block.departmentId === activeDepartmentId.value))
const inheritedBlocks = computed(() => visibleBlocks.value.filter((block) => !ownBlocks.value.includes(block)))

function scopeLabel(block: ContentSignatureBlock): string {
  if (!block.departmentId) return 'Verein'
  return activeOrganization.value?.departments.find((item) => item.id === block.departmentId)?.name ?? 'Abteilung'
}

async function loadAll() {
  if (!organizationId.value) { loading.value = false; return }
  loading.value = true
  loadError.value = false
  try {
    const [departmentsResult, blocksResponse] = await Promise.all([
      supabase.from('departments').select('id, name').eq('organization_id', organizationId.value).is('archived_at', null).order('name'),
      api.request('/v1/content-signature-blocks', { query: { organizationId: organizationId.value } }, z.object({ blocks: z.array(ContentSignatureBlockSchema) })),
    ])
    if (departmentsResult.error) { loadError.value = true; return }
    departments.value = departmentsResult.data.map((row) => ({ id: row.id, name: row.name }))
    blocks.value = blocksResponse.blocks
  } catch {
    loadError.value = true
  } finally {
    loading.value = false
  }
}
await loadAll()

// --- Anlage ------------------------------------------------------------------------------

const draft = ref<ContentSignatureBlockDraft>(emptyContentSignatureBlockDraft())
const createError = ref('')

async function createBlock() {
  if (!organizationId.value) return
  saving.value = true
  createError.value = ''
  try {
    const body = CreateContentSignatureBlockRequestSchema.parse({
      ...draft.value,
      organizationId: organizationId.value,
      departmentId: activeDepartmentId.value ?? undefined,
    })
    await api.request('/v1/content-signature-blocks', { method: 'POST', body })
    draft.value = emptyContentSignatureBlockDraft()
    await loadAll()
  } catch {
    createError.value = 'Der Textbaustein konnte nicht angelegt werden.'
  } finally {
    saving.value = false
  }
}

// --- Bearbeitung ---------------------------------------------------------------------------

const editingId = ref<string | null>(null)
const editDraft = ref<ContentSignatureBlockDraft>(emptyContentSignatureBlockDraft())
const editSaving = ref(false)
const editError = ref('')

// Beim Vereinswechsel duerfen weder die zuvor gewaehlte Abteilung noch ein offener Entwurf
// weiterverwendet werden. Sonst waere die Anzeige bis zum naechsten manuellen Reload veraltet.
watch(organizationId, () => {
  activeDepartmentId.value = null
  editingId.value = null
  createError.value = ''
  deleteError.value = ''
  editError.value = ''
  void loadAll()
})

function startEdit(block: ContentSignatureBlock) {
  editingId.value = block.id
  editDraft.value = { name: block.name, body: block.body }
  editError.value = ''
}
function cancelEdit() {
  editingId.value = null
}
async function saveEdit() {
  if (!editingId.value) return
  editSaving.value = true
  editError.value = ''
  try {
    const body = UpdateContentSignatureBlockRequestSchema.parse(editDraft.value)
    await api.request(`/v1/content-signature-blocks/${editingId.value}`, { method: 'PATCH', body })
    editingId.value = null
    await loadAll()
  } catch {
    editError.value = 'Die Änderung konnte nicht gespeichert werden.'
  } finally {
    editSaving.value = false
  }
}

// --- Löschen ---------------------------------------------------------------------------

const deletingId = ref<string | null>(null)
const deleteError = ref('')
async function deleteBlock(block: ContentSignatureBlock) {
  if (!confirm(`"${block.name}" wirklich löschen?`)) return
  deletingId.value = block.id
  deleteError.value = ''
  try {
    await api.request(`/v1/content-signature-blocks/${block.id}`, { method: 'DELETE' })
    if (editingId.value === block.id) editingId.value = null
    await loadAll()
  } catch {
    deleteError.value = 'Der Textbaustein konnte nicht gelöscht werden.'
  } finally {
    deletingId.value = null
  }
}
</script>

<template>
  <div>
    <header class="mb-8">
      <div class="eyebrow mb-3">Vereinsprofil</div>
      <h1 class="font-display text-3xl font-extrabold tracking-[-.04em]">Textbausteine</h1>
      <p class="mt-2 text-sm text-[#727a75]">Wiederverwendbare Signaturen — CTA, Footer oder ein Verweis auf eure Homepage — die sich einem Beitrag beim Erstellen anhängen lassen.</p>
    </header>

    <div v-if="loading" class="p-8 text-center text-xs text-[#7b827d]">Wird geladen …</div>
    <div v-else-if="loadError" class="card p-8 text-center text-sm font-semibold text-red-700">Die Textbausteine konnten nicht geladen werden. Bitte lade die Seite neu.</div>
    <template v-else>
      <div class="card mb-6 flex flex-wrap items-center gap-2 p-4" role="group" aria-label="Ebene wählen">
        <button type="button" :aria-pressed="activeDepartmentId === null" class="focus-ring rounded-lg px-3 py-1.5 text-xs font-semibold" :class="activeDepartmentId === null ? 'bg-forest text-white' : 'bg-[#eef1ea] text-[#5b625d]'" @click="selectScope(null)">Verein</button>
        <button v-for="department in departments" :key="department.id" type="button" :aria-pressed="activeDepartmentId === department.id" class="focus-ring rounded-lg px-3 py-1.5 text-xs font-semibold" :class="activeDepartmentId === department.id ? 'bg-forest text-white' : 'bg-[#eef1ea] text-[#5b625d]'" @click="selectScope(department.id)">{{ department.name }}</button>
      </div>

      <div class="max-w-2xl space-y-6">
        <section v-if="!canManageActiveLevel" class="card p-6 text-center text-sm text-[#7b827d]">
          Du hast auf dieser Ebene keine Berechtigung, Textbausteine zu verwalten.
        </section>
        <ContentSignatureBlockForm v-else v-model:draft="draft" :saving="saving" :error="createError" submit-label="Textbaustein anlegen" @save="createBlock" />

        <section class="card p-6">
          <h2 class="mb-4 font-display text-base font-bold">Bausteine dieser Ebene ({{ ownBlocks.length }})</h2>
          <div v-for="block in ownBlocks" :key="block.id" class="border-t border-[#e9ebe4] py-4 first:border-t-0 first:pt-0">
            <template v-if="editingId === block.id">
              <ContentSignatureBlockForm v-model:draft="editDraft" :saving="editSaving" :error="editError" submit-label="Speichern" cancellable @save="saveEdit" @cancel="cancelEdit" />
            </template>
            <template v-else>
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p class="text-sm font-semibold">{{ block.name }}</p>
                  <p class="mt-1 text-xs text-[#5b625d]">{{ block.body }}</p>
                  <p class="mt-1 text-[11px] text-[#9aa096]">{{ scopeLabel(block) }}<span v-if="!block.isActive"> · deaktiviert</span></p>
                </div>
                <div v-if="canManageActiveLevel" class="flex shrink-0 gap-2">
                  <button type="button" class="focus-ring rounded-lg border border-[#dfe0d9] px-3 py-1.5 text-[11px] font-semibold" @click="startEdit(block)">Bearbeiten</button>
                  <button type="button" :disabled="deletingId === block.id" class="focus-ring rounded-lg px-3 py-1.5 text-[11px] font-semibold text-amber-800 hover:bg-amber-50 disabled:opacity-60" @click="deleteBlock(block)">
                    {{ deletingId === block.id ? 'Wird gelöscht …' : 'Löschen' }}
                  </button>
                </div>
              </div>
            </template>
          </div>
          <p v-if="!ownBlocks.length" class="py-4 text-center text-xs text-[#9aa096]">Noch kein eigener Textbaustein auf dieser Ebene angelegt.</p>
        </section>

        <section v-if="inheritedBlocks.length" class="card p-6">
          <h2 class="mb-4 font-display text-base font-bold">Geerbt vom Verein ({{ inheritedBlocks.length }})</h2>
          <div v-for="block in inheritedBlocks" :key="block.id" class="border-t border-[#e9ebe4] py-3 first:border-t-0 first:pt-0">
            <p class="text-sm font-semibold">{{ block.name }}</p>
            <p class="mt-1 text-xs text-[#5b625d]">{{ block.body }}</p>
          </div>
        </section>

        <p v-if="deleteError" class="text-sm text-amber-800">{{ deleteError }}</p>
      </div>
    </template>
  </div>
</template>
