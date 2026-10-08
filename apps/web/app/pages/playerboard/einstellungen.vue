<script setup lang="ts">
import { CameraOff, Copy, Lock, Save } from '@lucide/vue'
import {
  PlayerboardPhotoConsentSchema,
  PlayerboardPlayerSchema,
  ScopePlayerboardSettingsSchema,
  type PlayerboardOverridableField,
  type PlayerboardPlayer,
  type PlayerboardSettingsValues,
  type PlayerboardStatsVisibility,
  type ScopeLevel,
  type ScopePlayerboardSettings,
} from '@vereinsfunk/contracts'
import { playerboardErrorMessage } from '../../utils/playerboardErrors'
import { replaceableState, restrictionState, settingsPatch, suggestPublicSlug } from '../../utils/playerboardSettings'

// Paket 052, PR 3: PlayerBoard-Einstellungen je Ebene. Saisonbeginn und Sichtbarkeit gibt eine
// Ebene vor; darunter laesst sich nur abweichen, wenn sie das freigibt (eine Ebene weit).
// Erlaubnisse (Mannschaftskategorien, oeffentliche Seite) lassen sich nach unten nur verschaerfen.
// Zustaende geerbt / eigener Wert / gesperrt wie PolicyFlagToggles.vue.
const api = useApiClient()
const { levels, organizationId } = await usePlayerboardTeam()

const selectedScope = ref<ScopeLevel>(levels.value.at(-1)?.scope ?? 'organization')
watch(levels, (list) => {
  if (!list.some((level) => level.scope === selectedScope.value)) selectedScope.value = list.at(-1)?.scope ?? 'organization'
})
const level = computed(() => levels.value.find((item) => item.scope === selectedScope.value) ?? null)

const entries = ref<ScopePlayerboardSettings[]>([])
const loading = ref(false)
const errorMessage = ref('')
const saveError = ref('')
const notice = ref('')

async function load() {
  errorMessage.value = ''
  if (!organizationId.value) return
  loading.value = true
  try {
    entries.value = await api.request(`/v1/organizations/${organizationId.value}/playerboard/settings`, {}, ScopePlayerboardSettingsSchema.array())
  } catch (error) {
    errorMessage.value = playerboardErrorMessage(error, 'Die Einstellungen konnten nicht geladen werden.')
  } finally {
    loading.value = false
  }
}
await load()
watch(organizationId, () => { void load() })

const entry = computed(() => (level.value ? entries.value.find((item) => item.scope === level.value!.scope && item.scopeId === level.value!.scopeId) ?? null : null))
const draft = ref<PlayerboardSettingsValues | null>(null)
watch(entry, (value) => { draft.value = value ? structuredClone(toRaw(value.own)) : null }, { immediate: true })
const patch = computed(() => (entry.value && draft.value ? settingsPatch(entry.value.own, draft.value) : {}))
const dirty = computed(() => Object.keys(patch.value).length > 0)
const canEdit = computed(() => entry.value?.canEdit === true)
const levelAbove = computed(() => (selectedScope.value === 'team' ? 'Abteilung oder Verein' : selectedScope.value === 'department' ? 'Verein' : ''))
const levelBelow = computed(() => (selectedScope.value === 'organization' ? 'Abteilungen' : 'Mannschaften'))
// Der Verein erbt nichts: ohne eigenen Wert gilt dort der Standard.
const inheritedLabel = computed(() => (selectedScope.value === 'organization' ? 'Standard' : 'geerbt'))
watch(selectedScope, () => { notice.value = ''; saveError.value = '' })

// --- Speichern ---------------------------------------------------------------------------------

const saving = ref(false)
async function save() {
  if (!entry.value || !dirty.value) return
  saving.value = true
  saveError.value = ''
  notice.value = ''
  try {
    await api.request('/v1/playerboard/settings', {
      method: 'PUT', body: { scope: entry.value.scope, scopeId: entry.value.scopeId, patch: patch.value },
    }, ScopePlayerboardSettingsSchema)
    // Eine Aenderung wirkt auf die Ebenen darunter -- deshalb alles neu laden.
    await load()
    notice.value = 'Gespeichert.'
  } catch (error) {
    saveError.value = playerboardErrorMessage(error, 'Die Einstellungen konnten nicht gespeichert werden.')
  } finally {
    saving.value = false
  }
}
usePageSaveFab({ label: 'Einstellungen speichern', save, saving, disabled: computed(() => !dirty.value), visible: computed(() => canEdit.value && dirty.value), icon: Save })

// --- Felder ------------------------------------------------------------------------------------

const visibilityLabels: Record<PlayerboardStatsVisibility, string> = {
  team: 'Nur die eigene Mannschaft',
  department: 'Die ganze Abteilung',
  organization: 'Der ganze Verein',
}
const seasonFormat = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long', timeZone: 'UTC' })
function formatSeason(value: string | null): string {
  return value ? seasonFormat.format(new Date(`${value}T00:00:00Z`)) : 'nicht festgelegt'
}

function setOwnSeason(enabled: boolean) {
  if (!draft.value) return
  draft.value.seasonStart = enabled ? (entry.value?.effective.seasonStart ?? `${new Date().getFullYear()}-08-01`) : null
}
function setOwnVisibility(enabled: boolean) {
  if (!draft.value) return
  draft.value.statsVisibility = enabled ? (entry.value?.effective.statsVisibility ?? 'team') : null
}
function toggleRelease(field: PlayerboardOverridableField, enabled: boolean) {
  if (!draft.value) return
  const current = draft.value.overridableFields.filter((item) => item !== field)
  draft.value.overridableFields = enabled ? [...current, field] : current
}
function setRestriction(field: 'teamCategoriesAllowed' | 'publicSharingAllowed', restricted: boolean) {
  if (!draft.value) return
  // Nur verschaerfen: false (hier verboten) oder null (erbt die Erlaubnis von oben).
  draft.value[field] = restricted ? false : null
}

const restrictionFields = [
  { field: 'teamCategoriesAllowed' as const, label: 'Eigene Kategorien der Mannschaften', restrictedLabel: 'nicht erlaubt' },
  { field: 'publicSharingAllowed' as const, label: 'Öffentliche Mannschaftsseiten', restrictedLabel: 'nicht erlaubt' },
]

// --- Oeffentliche Mannschaftsseite -------------------------------------------------------------

const publicUrl = computed(() => (entry.value?.publicPath && import.meta.client ? `${window.location.origin}${entry.value.publicPath}` : ''))
const copied = ref(false)
async function copyLink() {
  if (!publicUrl.value) return
  await navigator.clipboard.writeText(publicUrl.value)
  copied.value = true
  setTimeout(() => { copied.value = false }, 2000)
}

// Spieler ohne gueltige Einwilligung fuer oeffentliche Fotos (nur Mannschaftsebene, nur Trainer).
const playersWithoutConsent = ref<PlayerboardPlayer[] | null>(null)
async function loadConsents() {
  playersWithoutConsent.value = null
  const current = level.value
  if (current?.scope !== 'team' || !useCan('training.manage', current.permissionScope)) return
  try {
    const [roster, consents] = await Promise.all([
      api.request(`/v1/playerboard/teams/${current.scopeId}/players`, {}, PlayerboardPlayerSchema.array()),
      api.request(`/v1/playerboard/teams/${current.scopeId}/photo-consents`, {}, PlayerboardPhotoConsentSchema.array()),
    ])
    const missing = new Set(consents.filter((consent) => !consent.consentRecordId).map((consent) => consent.playerId))
    playersWithoutConsent.value = roster.filter((player) => player.active && missing.has(player.id))
  } catch {
    playersWithoutConsent.value = null
  }
}
await loadConsents()
watch(() => level.value && `${level.value.scope}:${level.value.scopeId}`, () => { void loadConsents() })

const chipClass = 'rounded-full px-2 py-0.5 text-[10px] font-bold'
const inputClass = 'focus-ring h-11 rounded-xl border border-[#dfe0d9] bg-white px-3 text-sm text-ink disabled:bg-[#f4f4ef] disabled:text-[#9aa096]'
</script>

<template>
  <div>
    <header class="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        <div class="eyebrow mb-3">PlayerBoard verwalten</div>
        <h1 class="font-display text-3xl font-extrabold tracking-[-.045em] text-ink">Einstellungen</h1>
        <p class="mt-2 max-w-2xl text-sm text-[#6c756f]">Was der Verein vorgibt, gilt darunter. Abweichen kann eine Ebene nur, wenn die Ebene darüber es freigibt; Erlaubnisse lassen sich nach unten nur einschränken.</p>
      </div>
      <PlayerboardTeamPicker />
    </header>

    <PlayerboardLevelTabs v-model="selectedScope" :levels="levels" />

    <p v-if="loading && entries.length === 0" class="text-xs text-[#7b827d]">Wird geladen …</p>
    <p v-else-if="errorMessage" class="text-sm text-amber-800">{{ errorMessage }}</p>
    <p v-else-if="!entry || !draft" class="card p-6 text-sm text-[#6c756f]">Für diese Ebene liegen keine Einstellungen vor.</p>
    <template v-else>
      <p v-if="!canEdit" class="mb-4 text-xs text-[#6c756f]">Du kannst die Einstellungen dieser Ebene ansehen, aber nicht ändern.</p>
      <p v-if="saveError" class="mb-4 text-sm font-semibold text-amber-800" role="alert">{{ saveError }}</p>
      <p v-if="notice && !dirty" class="mb-4 text-sm font-semibold text-forest" role="status">{{ notice }}</p>

      <section class="card mb-5 divide-y divide-[#ecece5] p-0" aria-labelledby="season-heading">
        <h2 id="season-heading" class="px-5 pt-5 pb-3 font-display text-base font-bold text-ink">Saison und Sichtbarkeit</h2>

        <!-- Saisonbeginn -->
        <div class="grid gap-3 px-5 py-4 sm:grid-cols-[1fr_auto] sm:items-center">
          <div>
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-sm font-semibold text-ink">Saisonbeginn</span>
              <span v-if="replaceableState(entry, 'seasonStart') === 'locked'" :class="[chipClass, 'bg-[#eef1ea] text-[#9aa096]']"><Lock :size="10" class="mr-0.5 inline" />gesperrt</span>
              <span v-else-if="draft.seasonStart === null" :class="[chipClass, 'bg-[#eef1ea] text-[#5b625d]']">{{ inheritedLabel }}</span>
              <span v-else :class="[chipClass, 'bg-amber-100 text-amber-800']">eigener Wert</span>
            </div>
            <p class="mt-1 text-xs text-[#6c756f]">
              Ab hier zählt die Rangliste „Saison“. Wirksam: {{ formatSeason(entry.effective.seasonStart) }}.
              <template v-if="replaceableState(entry, 'seasonStart') === 'locked'"> Von {{ levelAbove }} verbindlich vorgegeben.</template>
            </p>
          </div>
          <div v-if="replaceableState(entry, 'seasonStart') !== 'locked'" class="flex flex-wrap items-center gap-3">
            <label v-if="selectedScope !== 'organization'" class="flex min-h-11 cursor-pointer items-center gap-2 text-xs font-semibold text-ink">
              <input type="checkbox" class="h-5 w-5 accent-forest" :checked="draft.seasonStart !== null" :disabled="!canEdit" @change="setOwnSeason(($event.target as HTMLInputElement).checked)" /> eigener Wert
            </label>
            <input
              v-if="draft.seasonStart !== null || selectedScope === 'organization'"
              :value="draft.seasonStart ?? ''"
              type="date"
              :disabled="!canEdit"
              aria-label="Saisonbeginn"
              :class="inputClass"
              @input="draft.seasonStart = ($event.target as HTMLInputElement).value || null"
            />
          </div>
        </div>

        <!-- Sichtbarkeit -->
        <div class="grid gap-3 px-5 py-4 sm:grid-cols-[1fr_auto] sm:items-center">
          <div>
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-sm font-semibold text-ink">Wer sieht Punkte und Rangliste?</span>
              <span v-if="replaceableState(entry, 'statsVisibility') === 'locked'" :class="[chipClass, 'bg-[#eef1ea] text-[#9aa096]']"><Lock :size="10" class="mr-0.5 inline" />gesperrt</span>
              <span v-else-if="draft.statsVisibility === null" :class="[chipClass, 'bg-[#eef1ea] text-[#5b625d]']">{{ inheritedLabel }}</span>
              <span v-else :class="[chipClass, 'bg-amber-100 text-amber-800']">eigener Wert</span>
            </div>
            <p class="mt-1 text-xs text-[#6c756f]">
              Wirksam: {{ visibilityLabels[entry.effective.statsVisibility] }}. Trainingsnotizen und Fotos bleiben immer in der Mannschaft.
              <template v-if="replaceableState(entry, 'statsVisibility') === 'locked'"> Von {{ levelAbove }} verbindlich vorgegeben.</template>
            </p>
          </div>
          <div v-if="replaceableState(entry, 'statsVisibility') !== 'locked'" class="flex flex-wrap items-center gap-3">
            <label class="flex min-h-11 cursor-pointer items-center gap-2 text-xs font-semibold text-ink">
              <input type="checkbox" class="h-5 w-5 accent-forest" :checked="draft.statsVisibility !== null" :disabled="!canEdit" @change="setOwnVisibility(($event.target as HTMLInputElement).checked)" /> eigener Wert
            </label>
            <select v-if="draft.statsVisibility !== null" v-model="draft.statsVisibility" :disabled="!canEdit" aria-label="Sichtbarkeit" :class="inputClass">
              <option v-for="(label, value) in visibilityLabels" :key="value" :value="value">{{ label }}</option>
            </select>
          </div>
        </div>

        <!-- Freigaben fuer die Ebene darunter -->
        <div v-if="selectedScope !== 'team'" class="px-5 py-4">
          <span class="text-sm font-semibold text-ink">Freigabe für {{ levelBelow }}</span>
          <p class="mt-1 text-xs text-[#6c756f]">Ohne Freigabe gilt der Wert dieser Ebene verbindlich. Eine Freigabe reicht nur eine Ebene weit.</p>
          <div class="mt-2 flex flex-wrap gap-x-6">
            <label class="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-ink">
              <input type="checkbox" class="h-5 w-5 accent-forest" :checked="draft.overridableFields.includes('season_start')" :disabled="!canEdit" @change="toggleRelease('season_start', ($event.target as HTMLInputElement).checked)" />
              Saisonbeginn darf abweichen
            </label>
            <label class="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-ink">
              <input type="checkbox" class="h-5 w-5 accent-forest" :checked="draft.overridableFields.includes('stats_visibility')" :disabled="!canEdit" @change="toggleRelease('stats_visibility', ($event.target as HTMLInputElement).checked)" />
              Sichtbarkeit darf abweichen
            </label>
          </div>
        </div>
      </section>

      <section v-if="selectedScope !== 'team'" class="card mb-5 p-5" aria-labelledby="permissions-heading">
        <h2 id="permissions-heading" class="mb-3 font-display text-base font-bold text-ink">Erlaubnisse</h2>
        <div v-for="item in restrictionFields" :key="item.field" class="flex min-h-11 flex-wrap items-center justify-between gap-2">
          <span class="text-sm text-ink">{{ item.label }}</span>
          <span v-if="restrictionState(entry, item.field) === 'locked'" :class="[chipClass, 'bg-[#eef1ea] text-[#9aa096]']">gesperrt (von {{ levelAbove }} nicht erlaubt)</span>
          <button
            v-else-if="canEdit"
            type="button"
            class="focus-ring min-h-11 rounded-full px-4 text-xs font-semibold"
            :class="draft[item.field] === false ? 'bg-amber-100 text-amber-800' : 'bg-[#eef1ea] text-[#5b625d]'"
            :aria-pressed="draft[item.field] === false"
            @click="setRestriction(item.field, draft[item.field] !== false)"
          >
            {{ draft[item.field] === false ? `hier ${item.restrictedLabel}` : selectedScope === 'organization' ? 'erlaubt' : 'erlaubt (geerbt)' }}
          </button>
          <span v-else :class="[chipClass, 'bg-[#eef1ea] text-[#5b625d]']">{{ entry.effective[item.field] ? 'erlaubt' : 'nicht erlaubt' }}</span>
        </div>
      </section>

      <section v-if="selectedScope === 'team'" class="card mb-5 p-5" aria-labelledby="public-heading">
        <h2 id="public-heading" class="font-display text-base font-bold text-ink">Öffentliche Mannschaftsseite</h2>
        <p class="mt-1 text-xs text-[#6c756f]">Ohne Anmeldung erreichbar. Spieler erscheinen dort nur mit Rückennummer und Initialen, z. B. „#7 M. K.“ – nie mit Namen.</p>
        <p v-if="!entry.effective.publicSharingAllowed" class="mt-3 rounded-xl bg-[#eef1ea] p-3 text-sm text-[#5b625d]">
          <Lock :size="14" class="mr-1 inline" /> Von {{ levelAbove }} nicht erlaubt.
        </p>
        <template v-else>
          <div class="mt-3 flex flex-wrap gap-x-6">
            <label class="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-ink">
              <input type="checkbox" class="h-5 w-5 accent-forest" :checked="draft.publicPointsEnabled === true" :disabled="!canEdit" @change="draft.publicPointsEnabled = ($event.target as HTMLInputElement).checked" />
              Rangliste zeigen
            </label>
            <label class="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-ink">
              <input type="checkbox" class="h-5 w-5 accent-forest" :checked="draft.publicPhotosEnabled === true" :disabled="!canEdit" @change="draft.publicPhotosEnabled = ($event.target as HTMLInputElement).checked" />
              Geprüfte Trainingsfotos zeigen
            </label>
          </div>
          <label class="mt-3 grid max-w-md gap-1.5 text-xs font-semibold text-[#5b625d]">
            Adresse der Seite
            <span class="flex gap-2">
              <input
                :value="draft.publicSlug ?? ''"
                :disabled="!canEdit"
                maxlength="80"
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                :placeholder="suggestPublicSlug(entry.name)"
                :class="[inputClass, 'min-w-0 flex-1']"
                @input="draft.publicSlug = ($event.target as HTMLInputElement).value.trim().toLowerCase() || null"
              />
              <button v-if="canEdit && !draft.publicSlug" type="button" class="focus-ring min-h-11 rounded-xl border border-[#dfe0d9] px-3 text-xs font-semibold text-ink" @click="draft.publicSlug = suggestPublicSlug(entry.name)">Vorschlag</button>
            </span>
            <span class="font-normal text-[#9aa096]">Kleinbuchstaben, Ziffern und Bindestriche.</span>
          </label>
          <div v-if="publicUrl && !dirty" class="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-[#f6f8f3] p-3">
            <code class="min-w-0 flex-1 break-all text-xs text-ink">{{ publicUrl }}</code>
            <button type="button" class="focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-[#dfe0d9] bg-white px-3 text-xs font-semibold text-ink" @click="copyLink">
              <Copy :size="14" /> {{ copied ? 'Kopiert' : 'Link kopieren' }}
            </button>
          </div>
        </template>

        <div v-if="playersWithoutConsent" class="mt-5 border-t border-[#ecece5] pt-4">
          <h3 class="flex items-center gap-2 text-sm font-semibold text-ink"><CameraOff :size="15" class="text-amber-700" /> Ohne Einwilligung für öffentliche Fotos</h3>
          <p v-if="playersWithoutConsent.length === 0" class="mt-1 text-xs text-[#6c756f]">Für alle aktiven Spieler liegt eine gültige Einwilligung vor.</p>
          <template v-else>
            <p class="mt-1 text-xs text-[#6c756f]">Fotos, auf denen sie erkennbar sind, bleiben intern. Einwilligungen holst du unter <NuxtLink to="/einwilligungen" class="font-semibold text-forest underline">Einwilligungen</NuxtLink> ein.</p>
            <ul class="mt-2 flex flex-wrap gap-2">
              <li v-for="player in playersWithoutConsent" :key="player.id" class="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900">
                {{ player.jerseyNumber !== null ? `#${player.jerseyNumber} ` : '' }}{{ player.firstName }} {{ player.lastName }}
              </li>
            </ul>
          </template>
        </div>
      </section>
    </template>
  </div>
</template>
