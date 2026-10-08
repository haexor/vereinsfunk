<script setup lang="ts">
import { AlertTriangle, CheckCircle2, LoaderCircle, RefreshCw, Video } from '@lucide/vue'
import type { PlayerboardVeoConflict, PlayerboardVeoLoginResponse, PlayerboardVeoStatus } from '@vereinsfunk/contracts'
import { playerboardErrorMessage } from '../../utils/playerboardErrors'

// Paket 053, PR 3: Veo verbinden und abgleichen (playerboard.manage auf der Mannschaft). E-Mail und
// Passwort gehen einmal an die API, die sich damit bei Veo anmeldet; gespeichert wird nur das
// verschluesselte Veo-Cookie. Der Abgleich laeuft im Hintergrund; die Seite fragt nach, bis er fertig ist.
const { team, teamId, organizationTimezone, permissionScope } = await usePlayerboardTeam()
const veo = usePlayerboardVeo()
const canManagePlayerboard = computed(() => (permissionScope.value ? useCan('playerboard.manage', permissionScope.value) : false))

const status = ref<PlayerboardVeoStatus | null>(null)
const conflicts = ref<PlayerboardVeoConflict[]>([])
const errorMessage = ref('')
const notice = ref('')

/** Laedt Status und offene mehrdeutige Spiele der gewaehlten Mannschaft. */
let latestRequest = 0
async function load() {
  const request = ++latestRequest
  errorMessage.value = ''
  if (!teamId.value || !canManagePlayerboard.value) {
    status.value = null
    conflicts.value = []
    return
  }
  try {
    const [loadedStatus, loadedConflicts] = await Promise.all([veo.loadStatus(teamId.value), veo.loadConflicts(teamId.value)])
    if (request !== latestRequest) return
    status.value = loadedStatus
    conflicts.value = loadedConflicts
  } catch (error) {
    if (request === latestRequest) errorMessage.value = playerboardErrorMessage(error, 'Der Veo-Status konnte nicht geladen werden.')
  }
}
await load()
watch(teamId, () => {
  resetLogin()
  void load()
})

// --- Verbinden ---------------------------------------------------------------------------------
const reconnecting = ref(false)
const email = ref('')
const password = ref('')
const loginBusy = ref(false)
const login = ref<PlayerboardVeoLoginResponse | null>(null)
const choice = ref('')
const linkBusy = ref(false)
const showForm = computed(() => !status.value?.linked || reconnecting.value)

/** Verwirft Anmeldung und Auswahl, z. B. beim Mannschaftswechsel. */
function resetLogin() {
  reconnecting.value = false
  email.value = ''
  password.value = ''
  login.value = null
  choice.value = ''
}

/** Meldet sich bei Veo an; das Passwort wird danach sofort aus dem Formular entfernt. */
async function submitLogin() {
  if (!teamId.value) return
  loginBusy.value = true
  errorMessage.value = ''
  try {
    login.value = await veo.login(teamId.value, email.value.trim(), password.value)
    const teams = login.value.clubs.flatMap((club) => club.teams.map((veoTeam) => `${club.slug}/${veoTeam.slug}`))
    choice.value = teams.length === 1 ? teams[0]! : ''
  } catch (error) {
    errorMessage.value = playerboardErrorMessage(error, 'Die Anmeldung bei Veo hat nicht geklappt.')
  } finally {
    password.value = ''
    loginBusy.value = false
  }
}

/** Verbindet mit der gewaehlten Veo-Mannschaft; der erste Abgleich startet sofort. */
async function submitLink() {
  if (!teamId.value || !login.value || !choice.value) return
  const [clubSlug, teamSlug] = choice.value.split('/') as [string, string]
  linkBusy.value = true
  errorMessage.value = ''
  try {
    status.value = await veo.link(teamId.value, login.value.linkToken, clubSlug, teamSlug)
    resetLogin()
    notice.value = 'Verbunden. Der erste Abgleich holt alle bisherigen Spiele, das dauert einen Moment.'
    watchRun()
  } catch (error) {
    errorMessage.value = playerboardErrorMessage(error, 'Die Verbindung konnte nicht gespeichert werden.')
  } finally {
    linkBusy.value = false
  }
}

// --- Abgleich ----------------------------------------------------------------------------------
const syncBusy = ref(false)
const running = computed(() => status.value?.runs[0]?.status === 'running')
let pollTimer: ReturnType<typeof setTimeout> | undefined
let pollsLeft = 0

/** Fragt den Status alle drei Sekunden ab, solange ein Lauf laeuft (hoechstens drei Minuten). */
function watchRun() {
  pollsLeft = 60
  if (pollTimer) clearTimeout(pollTimer)
  const tick = async () => {
    await load()
    pollsLeft -= 1
    if (running.value && pollsLeft > 0) pollTimer = setTimeout(tick, 3_000)
    else if (!running.value && notice.value) notice.value = ''
  }
  pollTimer = setTimeout(tick, 3_000)
}
onBeforeUnmount(() => { if (pollTimer) clearTimeout(pollTimer) })

/** Startet einen Abgleich und verfolgt ihn bis zum Ende. */
async function startSync() {
  if (!teamId.value) return
  syncBusy.value = true
  errorMessage.value = ''
  try {
    await veo.sync(teamId.value, crypto.randomUUID())
    notice.value = 'Abgleich gestartet.'
    await load()
    watchRun()
  } catch (error) {
    errorMessage.value = playerboardErrorMessage(error, 'Der Abgleich konnte nicht gestartet werden.')
  } finally {
    syncBusy.value = false
  }
}

// --- Mehrdeutige Spiele ------------------------------------------------------------------------
const conflictChoice = reactive<Record<string, string>>({})
const conflictBusy = ref<string | null>(null)

/** Haengt das Veo-Spiel an das gewaehlte Spiel, legt ein neues an oder laesst es dauerhaft aus. */
async function resolve(conflict: PlayerboardVeoConflict, action: 'fixture' | 'create' | 'ignore') {
  conflictBusy.value = conflict.id
  errorMessage.value = ''
  try {
    const fixtureId = conflictChoice[conflict.id]
    if (action === 'fixture' && !fixtureId) return
    await veo.resolveConflict(conflict.id, action === 'fixture' ? { action, fixtureId: fixtureId! } : { action })
    notice.value = action === 'ignore' ? 'Das Veo-Spiel wird künftig ausgelassen.' : 'Gespeichert. Der Abgleich übernimmt das Spiel jetzt.'
    await load()
    if (action !== 'ignore') watchRun()
  } catch (error) {
    errorMessage.value = playerboardErrorMessage(error, 'Das Spiel konnte nicht zugeordnet werden.')
  } finally {
    conflictBusy.value = null
  }
}

// --- Anzeige -----------------------------------------------------------------------------------
const dateTime = computed(() => new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: organizationTimezone.value }))
const RUN_STATUS: Readonly<Record<string, string>> = {
  running: 'läuft', succeeded: 'erfolgreich', failed: 'fehlgeschlagen', cancelled: 'abgebrochen', aborted_loss_threshold: 'abgebrochen',
}
const ERROR_TEXT: Readonly<Record<string, string>> = {
  auth_expired: 'Veo nimmt die Anmeldung nicht mehr an',
  upstream_changed: 'Veo hat seine Schnittstelle geändert',
  upstream_error: 'Veo war nicht erreichbar',
  stale_run: 'Abgleich hing und wurde beendet',
}
/** Kurzbeschreibung eines Laufs fuer den Verlauf. */
function runSummary(run: PlayerboardVeoStatus['runs'][number]): string {
  if (run.status === 'running') return 'läuft gerade …'
  const parts = [`${run.createdCount} neu`, `${run.updatedCount} aktualisiert`]
  if (run.conflictCount) parts.push(`${run.conflictCount} unklar`)
  if (run.errorClass) parts.push(ERROR_TEXT[run.errorClass] ?? run.errorClass)
  return parts.join(' · ')
}
const inputClass = 'focus-ring h-11 rounded-xl border border-[#dfe0d9] bg-white px-3 text-sm text-ink'
const buttonClass = 'focus-ring inline-flex min-h-11 items-center gap-2 rounded-xl bg-forest px-4 text-xs font-bold text-white disabled:opacity-60'
const secondaryButtonClass = 'focus-ring inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#dfe0d9] bg-white px-4 text-xs font-semibold text-ink disabled:opacity-60'
</script>

<template>
  <div>
    <header class="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <div class="eyebrow mb-3">PlayerBoard</div>
        <h1 class="font-display text-3xl font-extrabold tracking-[-.045em] text-ink">Veo</h1>
      </div>
      <PlayerboardTeamPicker />
    </header>

    <PlayerboardTeamEmpty v-if="!team" />
    <p v-else-if="!canManagePlayerboard" class="card p-6 text-sm text-[#6c756f]">Veo verbinden dürfen nur Trainer dieser Mannschaft.</p>
    <div v-else class="max-w-3xl space-y-5">
      <p v-if="errorMessage" class="rounded-xl bg-[#fbeee6] p-3 text-sm text-amber-800" role="alert">{{ errorMessage }}</p>
      <p v-if="notice" class="rounded-xl bg-[#e4f1e7] p-3 text-sm text-forest" role="status">{{ notice }}</p>

      <section v-if="status?.linked" class="card p-5" aria-labelledby="veo-link-heading">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="veo-link-heading" class="flex items-center gap-2 font-display text-base font-bold text-ink"><Video :size="18" /> Verbunden</h2>
            <p class="mt-1 text-sm text-[#5b625d]">{{ status.veoTeamName }} <span class="text-[#7b827d]">· {{ status.veoClubName }}</span></p>
            <p class="mt-1 text-xs text-[#7b827d]">Neue Spiele kommen jeden Morgen automatisch.</p>
          </div>
          <div class="flex flex-wrap gap-2">
            <button type="button" :class="buttonClass" :disabled="syncBusy || running || status.needsReconnect" @click="startSync">
              <RefreshCw :size="14" :class="running ? 'animate-spin' : ''" /> {{ running ? 'Abgleich läuft …' : 'Jetzt abgleichen' }}
            </button>
            <button v-if="!reconnecting" type="button" :class="secondaryButtonClass" @click="reconnecting = true">Neu verbinden</button>
          </div>
        </div>
        <p v-if="status.needsReconnect" class="mt-4 flex items-start gap-2 rounded-xl bg-[#fbeee6] p-3 text-sm text-amber-800">
          <AlertTriangle :size="16" class="mt-0.5 shrink-0" /> Veo nimmt die gespeicherte Anmeldung nicht mehr an. Bitte verbinde Veo neu, sonst kommen keine neuen Spiele.
        </p>
        <p v-else-if="status.consecutiveFailures > 0" class="mt-4 flex items-start gap-2 rounded-xl bg-[#fbeee6] p-3 text-sm text-amber-800">
          <AlertTriangle :size="16" class="mt-0.5 shrink-0" /> {{ status.consecutiveFailures === 1 ? 'Der letzte Abgleich ist' : `Die letzten ${status.consecutiveFailures} Abgleiche sind` }} fehlgeschlagen. Der nächste versucht es erneut.
        </p>
      </section>

      <section v-if="showForm" class="card p-5" aria-labelledby="veo-connect-heading">
        <h2 id="veo-connect-heading" class="font-display text-base font-bold text-ink">{{ status?.linked ? 'Neu verbinden' : 'Veo verbinden' }}</h2>
        <p class="mt-1 text-xs text-[#6c756f]">
          Melde dich mit deinem Veo-Account an. E-Mail und Passwort nutzen wir nur für diese eine Anmeldung und speichern sie nicht; aufbewahrt wird nur die verschlüsselte Veo-Sitzung.
        </p>
        <form v-if="!login" class="mt-4 grid max-w-md gap-3" @submit.prevent="submitLogin">
          <label class="grid gap-1.5 text-xs font-semibold text-[#5b625d]">E-Mail bei Veo
            <input v-model="email" type="email" autocomplete="username" required :class="inputClass" />
          </label>
          <label class="grid gap-1.5 text-xs font-semibold text-[#5b625d]">Passwort bei Veo
            <input v-model="password" type="password" autocomplete="current-password" required :class="inputClass" />
          </label>
          <div class="flex flex-wrap items-center gap-2">
            <button type="submit" :class="buttonClass" :disabled="loginBusy">
              <LoaderCircle v-if="loginBusy" :size="14" class="animate-spin" /> {{ loginBusy ? 'Anmeldung bei Veo läuft …' : 'Bei Veo anmelden' }}
            </button>
            <button v-if="reconnecting" type="button" :class="secondaryButtonClass" @click="resetLogin">Abbrechen</button>
          </div>
          <p v-if="loginBusy" class="text-xs text-[#7b827d]">Das kann bis zu einer halben Minute dauern.</p>
        </form>
        <form v-else class="mt-4 grid gap-3" @submit.prevent="submitLink">
          <fieldset v-for="club in login.clubs" :key="club.slug" class="grid gap-1">
            <legend class="mb-1 text-xs font-semibold text-[#5b625d]">{{ club.name }}</legend>
            <label v-for="veoTeam in club.teams" :key="veoTeam.slug" class="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-[#e8e9e2] px-3 text-sm text-ink">
              <input v-model="choice" type="radio" name="veo-team" :value="`${club.slug}/${veoTeam.slug}`" class="h-4 w-4 accent-forest" />
              {{ veoTeam.name }}
            </label>
          </fieldset>
          <p v-if="login.clubs.length === 0" class="text-sm text-[#6c756f]">Zu diesem Veo-Account gehört kein Verein.</p>
          <div class="flex flex-wrap gap-2">
            <button type="submit" :class="buttonClass" :disabled="!choice || linkBusy">
              <LoaderCircle v-if="linkBusy" :size="14" class="animate-spin" /> Mit {{ team?.name }} verbinden
            </button>
            <button type="button" :class="secondaryButtonClass" @click="resetLogin">Abbrechen</button>
          </div>
        </form>
      </section>

      <section v-if="conflicts.length" class="card p-5" aria-labelledby="veo-conflicts-heading">
        <h2 id="veo-conflicts-heading" class="font-display text-base font-bold text-ink">Spiele zuordnen</h2>
        <p class="mt-1 text-xs text-[#6c756f]">Zu diesen Veo-Spielen passen mehrere Spiele im Spielplan. Wähle das richtige, damit Ergebnis und Werte nicht doppelt erscheinen.</p>
        <ul class="mt-4 space-y-4">
          <li v-for="conflict in conflicts" :key="conflict.id" class="rounded-xl border border-[#e8e9e2] p-4">
            <p class="text-sm font-semibold text-ink">Veo: {{ conflict.label }}</p>
            <fieldset class="mt-2 grid gap-1">
              <legend class="sr-only">Passendes Spiel für {{ conflict.label }}</legend>
              <label v-for="candidate in conflict.candidates" :key="candidate.fixtureId" class="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-ink">
                <input v-model="conflictChoice[conflict.id]" type="radio" :name="`conflict-${conflict.id}`" :value="candidate.fixtureId" class="h-4 w-4 accent-forest" />
                {{ candidate.kickoffAt ? dateTime.format(new Date(candidate.kickoffAt)) : 'ohne Datum' }} · {{ candidate.opponentName ?? 'Gegner offen' }}<template v-if="candidate.isHome !== null"> · {{ candidate.isHome ? 'Heim' : 'Auswärts' }}</template>
              </label>
              <p v-if="conflict.candidates.length === 0" class="text-xs text-[#6c756f]">Die Kandidaten sind inzwischen vergeben. Lege ein neues Spiel an oder lass das Veo-Spiel aus.</p>
            </fieldset>
            <div class="mt-3 flex flex-wrap gap-2">
              <button type="button" :class="buttonClass" :disabled="!conflictChoice[conflict.id] || conflictBusy === conflict.id" @click="resolve(conflict, 'fixture')">Diesem Spiel zuordnen</button>
              <button type="button" :class="secondaryButtonClass" :disabled="conflictBusy === conflict.id" @click="resolve(conflict, 'create')">Als neues Spiel anlegen</button>
              <button type="button" :class="secondaryButtonClass" :disabled="conflictBusy === conflict.id" @click="resolve(conflict, 'ignore')">Auslassen</button>
            </div>
          </li>
        </ul>
      </section>

      <section v-if="status?.linked && status.runs.length" class="card p-5" aria-labelledby="veo-runs-heading">
        <h2 id="veo-runs-heading" class="font-display text-base font-bold text-ink">Letzte Abgleiche</h2>
        <ul class="mt-3 divide-y divide-[#eef0ea]">
          <li v-for="run in status.runs" :key="run.id" class="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <span class="flex items-center gap-2 text-ink">
              <CheckCircle2 v-if="run.status === 'succeeded'" :size="15" class="text-forest" />
              <LoaderCircle v-else-if="run.status === 'running'" :size="15" class="animate-spin text-[#7b827d]" />
              <AlertTriangle v-else :size="15" class="text-amber-700" />
              {{ dateTime.format(new Date(run.startedAt)) }} · {{ RUN_STATUS[run.status] ?? run.status }}
            </span>
            <span class="text-xs text-[#6c756f]">{{ runSummary(run) }}</span>
          </li>
        </ul>
        <NuxtLink to="/playerboard/spiele" class="mt-3 inline-block text-xs font-semibold text-forest underline">Zu den Spielen</NuxtLink>
      </section>
    </div>
  </div>
</template>
