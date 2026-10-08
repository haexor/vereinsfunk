<script setup lang="ts">
import { Mail, Pencil, Trash2, UserPlus } from '@lucide/vue'
import { DirectoryPersonSchema, PlayerboardInviteResponseSchema, PlayerboardPlayerSchema, type DirectoryPerson, type PlayerboardPlayer } from '@vereinsfunk/contracts'
import { playerboardErrorMessage } from '../../utils/playerboardErrors'

// Paket 052, PR 3: Kader der gewaehlten Mannschaft. Trainer legen Spieler selbst an (die
// Verzeichnisperson entsteht im Hintergrund) oder uebernehmen eine Person aus dem Verzeichnis der
// Mannschaft. Die E-Mail ist freiwillig und laesst sich jederzeit ergaenzen; "Einladen" geht,
// sobald eine Adresse da ist. Spieler mit Punkten werden nicht geloescht, sondern inaktiv gesetzt.
const api = useApiClient()
const { team, teamId, organizationId, permissionScope, canManage } = await usePlayerboardTeam()
const canInvite = computed(() => (permissionScope.value ? useCan('member.invite', permissionScope.value) : false))
const canReadDirectory = computed(() => (permissionScope.value ? useCan('directory.read', permissionScope.value) : false))

const players = ref<PlayerboardPlayer[]>([])
const loading = ref(false)
const errorMessage = ref('')
const actionError = ref('')
const notice = ref('')

async function load() {
  players.value = []
  errorMessage.value = ''
  const requestedTeamId = teamId.value
  if (!requestedTeamId) {
    loading.value = false
    return
  }
  loading.value = true
  try {
    const result = await api.request(`/v1/playerboard/teams/${requestedTeamId}/players`, {}, PlayerboardPlayerSchema.array())
    if (teamId.value === requestedTeamId) players.value = result
  } catch (error) {
    if (teamId.value === requestedTeamId) errorMessage.value = playerboardErrorMessage(error, 'Der Kader konnte nicht geladen werden.')
  } finally {
    if (teamId.value === requestedTeamId) loading.value = false
  }
}
await load()
watch(teamId, () => {
  createMode.value = 'new'
  directoryPeople.value = null
  editingId.value = null
  invitingId.value = null
  void load()
})

const activePlayers = computed(() => players.value.filter((player) => player.active))
const inactivePlayers = computed(() => players.value.filter((player) => !player.active))

function replacePlayer(player: PlayerboardPlayer) {
  if (player.teamId !== teamId.value) return
  players.value = players.value.some((item) => item.id === player.id)
    ? players.value.map((item) => (item.id === player.id ? player : item))
    : [...players.value, player]
}

// v-model auf type="number" liefert eine Zahl, ein geleertes Feld aber ''.
function optionalNumber(value: string | number): number | null {
  return typeof value === 'number' ? value : value.trim() === '' ? null : Number(value)
}

// --- Anlegen -----------------------------------------------------------------------------------

const createMode = ref<'new' | 'directory'>('new')
const createForm = reactive({ firstName: '', lastName: '', birthYear: '', jerseyNumber: '', position: '', email: '', directoryPersonId: '' })
const creating = ref(false)
const directoryPeople = ref<DirectoryPerson[] | null>(null)

const directoryCandidates = computed(() => {
  const inSquad = new Set(players.value.map((player) => player.directoryPersonId))
  return (directoryPeople.value ?? []).filter((person) => !inSquad.has(person.id) && person.status !== 'left')
})

async function loadDirectory() {
  const requestedOrganizationId = organizationId.value
  const requestedTeamId = teamId.value
  if (!requestedOrganizationId || !requestedTeamId || directoryPeople.value) return
  try {
    const result = await api.request(`/v1/organizations/${requestedOrganizationId}/directory-people`, { query: { teamId: requestedTeamId } }, DirectoryPersonSchema.array())
    if (organizationId.value === requestedOrganizationId && teamId.value === requestedTeamId) directoryPeople.value = result
  } catch {
    if (organizationId.value === requestedOrganizationId && teamId.value === requestedTeamId) {
      directoryPeople.value = null
      actionError.value = 'Das Verzeichnis der Mannschaft konnte nicht geladen werden.'
    }
  }
}
watch(createMode, (mode) => { if (mode === 'directory') void loadDirectory() })

async function createPlayer() {
  if (!teamId.value) return
  creating.value = true
  actionError.value = ''
  notice.value = ''
  try {
    const shared = { teamId: teamId.value, jerseyNumber: optionalNumber(createForm.jerseyNumber), position: createForm.position.trim() || null }
    const body = createMode.value === 'directory'
      ? { ...shared, directoryPersonId: createForm.directoryPersonId }
      : {
          ...shared,
          firstName: createForm.firstName.trim(),
          lastName: createForm.lastName.trim(),
          birthYear: optionalNumber(createForm.birthYear),
          email: createForm.email.trim() || null,
        }
    replacePlayer(await api.request('/v1/playerboard/players', { method: 'POST', body }, PlayerboardPlayerSchema))
    Object.assign(createForm, { firstName: '', lastName: '', birthYear: '', jerseyNumber: '', position: '', email: '', directoryPersonId: '' })
  } catch (error) {
    actionError.value = playerboardErrorMessage(error, 'Der Spieler konnte nicht angelegt werden.')
  } finally {
    creating.value = false
  }
}

// --- Bearbeiten --------------------------------------------------------------------------------

const editingId = ref<string | null>(null)
const editForm = reactive({ jerseyNumber: '', position: '', email: '', active: true })
const busyId = ref<string | null>(null)

function startEdit(player: PlayerboardPlayer) {
  editingId.value = player.id
  invitingId.value = null
  editForm.jerseyNumber = player.jerseyNumber === null ? '' : String(player.jerseyNumber)
  editForm.position = player.position ?? ''
  editForm.email = player.email ?? ''
  editForm.active = player.active
  actionError.value = ''
}

async function saveEdit(player: PlayerboardPlayer) {
  busyId.value = player.id
  actionError.value = ''
  try {
    replacePlayer(await api.request(`/v1/playerboard/players/${player.id}`, {
      method: 'PATCH',
      body: { jerseyNumber: optionalNumber(editForm.jerseyNumber), position: editForm.position.trim() || null, email: editForm.email.trim() || null, active: editForm.active },
    }, PlayerboardPlayerSchema))
    editingId.value = null
  } catch (error) {
    actionError.value = playerboardErrorMessage(error, 'Die Änderungen konnten nicht gespeichert werden.')
  } finally {
    busyId.value = null
  }
}

async function removePlayer(player: PlayerboardPlayer) {
  if (!window.confirm(`${player.firstName} ${player.lastName} aus dem Kader entfernen?`)) return
  busyId.value = player.id
  actionError.value = ''
  try {
    await api.request(`/v1/playerboard/players/${player.id}`, { method: 'DELETE' })
    players.value = players.value.filter((item) => item.id !== player.id)
    editingId.value = null
  } catch (error) {
    actionError.value = playerboardErrorMessage(error, 'Der Spieler konnte nicht entfernt werden.')
  } finally {
    busyId.value = null
  }
}

// --- Einladen ----------------------------------------------------------------------------------

const invitingId = ref<string | null>(null)
const inviteEmail = ref('')

function startInvite(player: PlayerboardPlayer) {
  invitingId.value = player.id
  editingId.value = null
  inviteEmail.value = player.email ?? ''
  actionError.value = ''
  notice.value = ''
}

async function sendInvite(player: PlayerboardPlayer) {
  busyId.value = player.id
  actionError.value = ''
  try {
    const email = inviteEmail.value.trim()
    const response = await api.request(`/v1/playerboard/players/${player.id}/invite`, {
      method: 'POST', body: email && email !== player.email ? { email } : {},
    }, PlayerboardInviteResponseSchema)
    // Die API meldet einen gescheiterten Mailversand mit 201 und emailDelivered: false (wie /mitglieder).
    notice.value = response?.emailDelivered === false
      ? `Die Einladung für ${player.firstName} ist angelegt, die E-Mail konnte aber nicht zugestellt werden. Du kannst sie unter „Mitglieder“ erneut senden.`
      : `Einladung an ${email || player.email} verschickt.`
    if (email && email !== player.email) replacePlayer({ ...player, email })
    invitingId.value = null
  } catch (error) {
    actionError.value = playerboardErrorMessage(error, 'Die Einladung konnte nicht verschickt werden.')
  } finally {
    busyId.value = null
  }
}

const inputClass = 'focus-ring h-11 w-full rounded-xl border border-[#dfe0d9] bg-white px-3 text-sm text-ink'
const labelClass = 'grid gap-1.5 text-xs font-semibold text-[#5b625d]'
</script>

<template>
  <div>
    <header class="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        <div class="eyebrow mb-3">PlayerBoard</div>
        <h1 class="font-display text-3xl font-extrabold tracking-[-.045em] text-ink">Kader</h1>
        <p class="mt-2 max-w-2xl text-sm text-[#6c756f]">Spieler der Mannschaft. Eine E-Mail-Adresse brauchst du nur für eine Einladung – die Mannschaft sieht Namen und Rückennummern, keine Adressen.</p>
      </div>
      <PlayerboardTeamPicker />
    </header>

    <PlayerboardTeamEmpty v-if="!team" />
    <template v-else>
      <p v-if="actionError" class="mb-4 text-sm font-semibold text-amber-800" role="alert">{{ actionError }}</p>
      <p v-if="notice" class="mb-4 text-sm font-semibold text-forest" role="status">{{ notice }}</p>

      <p v-if="loading" class="text-xs text-[#7b827d]">Wird geladen …</p>
      <p v-else-if="errorMessage" class="text-sm text-amber-800">{{ errorMessage }}</p>
      <template v-else>
        <section v-if="canManage" class="card mb-6 p-4 sm:p-5" aria-labelledby="create-heading">
          <h2 id="create-heading" class="mb-3 font-display text-base font-bold text-ink">Spieler hinzufügen</h2>
          <div v-if="canReadDirectory" class="mb-4 flex flex-wrap gap-2" role="radiogroup" aria-label="Woher kommt der Spieler?">
            <button type="button" role="radio" :aria-checked="createMode === 'new'" class="focus-ring min-h-11 rounded-xl border px-4 text-xs font-semibold" :class="createMode === 'new' ? 'border-forest bg-[#e4f1e7] text-forest' : 'border-[#dfe0d9] text-ink'" @click="createMode = 'new'">Neu anlegen</button>
            <button type="button" role="radio" :aria-checked="createMode === 'directory'" class="focus-ring min-h-11 rounded-xl border px-4 text-xs font-semibold" :class="createMode === 'directory' ? 'border-forest bg-[#e4f1e7] text-forest' : 'border-[#dfe0d9] text-ink'" @click="createMode = 'directory'">Aus dem Verzeichnis</button>
          </div>
          <form class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" @submit.prevent="createPlayer">
            <template v-if="createMode === 'new'">
              <label :class="labelClass">Vorname<input v-model="createForm.firstName" required maxlength="80" :class="inputClass" /></label>
              <label :class="labelClass">Nachname<input v-model="createForm.lastName" required maxlength="80" :class="inputClass" /></label>
              <label :class="labelClass">Geburtsjahr <span class="font-normal text-[#9aa096]">optional</span><input v-model="createForm.birthYear" type="number" inputmode="numeric" min="1900" max="2100" :class="inputClass" /></label>
              <label :class="labelClass">E-Mail <span class="font-normal text-[#9aa096]">optional, für eine Einladung</span><input v-model="createForm.email" type="email" autocomplete="off" :class="inputClass" /></label>
            </template>
            <label v-else :class="[labelClass, 'sm:col-span-2']">
              Person aus dem Verzeichnis der Mannschaft
              <select v-model="createForm.directoryPersonId" required :class="inputClass">
                <option value="" disabled>{{ directoryPeople === null ? 'Wird geladen …' : directoryCandidates.length ? 'Person wählen' : 'Keine weitere Person im Verzeichnis dieser Mannschaft' }}</option>
                <option v-for="person in directoryCandidates" :key="person.id" :value="person.id">{{ person.lastName }}, {{ person.firstName }}{{ person.birthYear ? ` (${person.birthYear})` : '' }}</option>
              </select>
            </label>
            <label :class="labelClass">Rückennummer <span class="font-normal text-[#9aa096]">optional</span><input v-model="createForm.jerseyNumber" type="number" inputmode="numeric" min="0" max="99" :class="inputClass" /></label>
            <label :class="labelClass">Position <span class="font-normal text-[#9aa096]">optional</span><input v-model="createForm.position" maxlength="40" :class="inputClass" /></label>
            <div class="flex items-end">
              <button type="submit" class="focus-ring inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-forest px-5 text-xs font-bold text-white disabled:opacity-60" :disabled="creating">
                <UserPlus :size="15" /> {{ creating ? 'Wird angelegt …' : 'Hinzufügen' }}
              </button>
            </div>
          </form>
        </section>

        <section v-if="players.length === 0" class="card p-8 text-center text-sm text-[#6c756f]">Noch kein Spieler im Kader.</section>
        <template v-for="group in [{ title: 'Aktiv', list: activePlayers }, { title: 'Inaktiv', list: inactivePlayers }]" :key="group.title">
          <section v-if="group.list.length > 0" class="mb-6">
            <h2 class="mb-2 text-[11px] font-bold uppercase tracking-[.12em] text-[#7b827d]">{{ group.title }} · {{ group.list.length }}</h2>
            <ul class="card divide-y divide-[#ecece5]">
              <li v-for="player in group.list" :key="player.id" class="p-3 sm:px-4" :data-testid="`player-${player.id}`">
                <div class="flex flex-wrap items-center gap-3">
                  <span class="grid h-10 min-w-10 shrink-0 place-items-center rounded-xl bg-[#eef1ea] px-1 text-sm font-bold text-forest">{{ player.jerseyNumber ?? '–' }}</span>
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-sm font-semibold text-ink">{{ player.firstName }} {{ player.lastName }}</span>
                    <span class="block truncate text-xs text-[#6c756f]">
                      {{ [player.position, canManage ? (player.email ?? 'keine E-Mail') : null, player.hasAccount ? 'Konto verbunden' : null].filter(Boolean).join(' · ') || '–' }}
                    </span>
                  </span>
                  <div v-if="canManage" class="flex gap-1">
                    <button v-if="canInvite && !player.hasAccount" type="button" class="focus-ring inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-xl border border-[#dfe0d9] px-3 text-xs font-semibold text-ink disabled:opacity-60" :disabled="busyId !== null" :aria-label="`${player.firstName} ${player.lastName} einladen`" @click="startInvite(player)">
                      <Mail :size="15" /><span class="hidden sm:inline">Einladen</span>
                    </button>
                    <button type="button" class="focus-ring grid min-h-11 w-11 place-items-center rounded-xl border border-[#dfe0d9] text-ink" :aria-label="`${player.firstName} ${player.lastName} bearbeiten`" @click="startEdit(player)">
                      <Pencil :size="15" />
                    </button>
                  </div>
                </div>

                <form v-if="invitingId === player.id" class="mt-3 flex flex-wrap items-end gap-2" @submit.prevent="sendInvite(player)">
                  <label :class="[labelClass, 'min-w-[220px] flex-1']">
                    E-Mail-Adresse für die Einladung
                    <input v-model="inviteEmail" type="email" required autocomplete="off" :class="inputClass" />
                  </label>
                  <button type="submit" class="focus-ring min-h-11 rounded-xl bg-forest px-4 text-xs font-bold text-white disabled:opacity-60" :disabled="busyId !== null">Einladung senden</button>
                  <button type="button" class="focus-ring min-h-11 rounded-xl border border-[#dfe0d9] px-4 text-xs font-semibold text-ink" @click="invitingId = null">Abbrechen</button>
                </form>

                <form v-if="editingId === player.id" class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" @submit.prevent="saveEdit(player)">
                  <label :class="labelClass">Rückennummer<input v-model="editForm.jerseyNumber" type="number" inputmode="numeric" min="0" max="99" :class="inputClass" /></label>
                  <label :class="labelClass">Position<input v-model="editForm.position" maxlength="40" :class="inputClass" /></label>
                  <label :class="labelClass">E-Mail<input v-model="editForm.email" type="email" autocomplete="off" :class="inputClass" /></label>
                  <label class="flex min-h-11 cursor-pointer items-center gap-3 self-end text-sm text-ink">
                    <input v-model="editForm.active" type="checkbox" class="h-5 w-5 accent-forest" /> Aktiv im Kader
                  </label>
                  <div class="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-4">
                    <button type="submit" class="focus-ring min-h-11 rounded-xl bg-forest px-5 text-xs font-bold text-white disabled:opacity-60" :disabled="busyId !== null">Speichern</button>
                    <button type="button" class="focus-ring min-h-11 rounded-xl border border-[#dfe0d9] px-5 text-xs font-semibold text-ink" @click="editingId = null">Abbrechen</button>
                    <button type="button" class="focus-ring ml-auto inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-[#dfe0d9] px-4 text-xs font-semibold text-[#8a4b3c] disabled:opacity-60" :disabled="busyId !== null" @click="removePlayer(player)">
                      <Trash2 :size="15" /> Aus dem Kader entfernen
                    </button>
                  </div>
                </form>
              </li>
            </ul>
          </section>
        </template>
      </template>
    </template>
  </div>
</template>
