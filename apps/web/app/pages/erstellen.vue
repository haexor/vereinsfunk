<script setup lang="ts">
import { ArrowLeft, ArrowRight, Check, ImagePlus, LoaderCircle, Sparkles, UploadCloud, X } from '@lucide/vue'
import { ClubEventSchema, FixtureSchema, type CommunicationGoal, type ContentPresetSlug, type GeneratedPost, type OutputFormat } from '@vereinsfunk/contracts'
import { factsFromClubEvent, factsFromFixture } from '@vereinsfunk/content-engine'

const config = useRuntimeConfig()
const route = useRoute()
const step = ref(1)
const loading = ref(false)
const apiNotice = ref('')
const selectedPreset = ref<ContentPresetSlug>('training_insight')
const goal = ref<CommunicationGoal>('inform')
const formats = ref<OutputFormat[]>(['feed_image', 'story'])
const form = reactive({ title: '', date: '', location: '', audience: '', observation: '', quote: '', doNotMention: '' })
const preview = ref<GeneratedPost | null>(null)
const session = await useSession()
const scope = await useScope()
const activeOrganization = computed(() => session.value?.scopes.find((item) => item.organizationId === scope.value?.organizationId) ?? null)
const timezone = computed(() => activeOrganization.value?.organizationTimezone ?? 'Europe/Berlin')
const fixtureId = ref<string | null>(null)
const clubEventId = ref<string | null>(null)
const prefilledFacts = ref<Record<string, string | number | boolean>>({})
const presets: { id: ContentPresetSlug; label: string; description: string }[] = [
  { id: 'children_program', label: 'Ballschule & Kinderangebote', description: 'Lernmomente und Bewegung' }, { id: 'training_insight', label: 'Trainingseinblick', description: 'Konkrete Übungen und Beobachtungen' }, { id: 'club_life', label: 'Vereinsleben', description: 'Echte Momente aus dem Alltag' }, { id: 'volunteering', label: 'Ehrenamt', description: 'Helfenden Danke sagen' },
  { id: 'people_spotlight', label: 'Menschen im Verein', description: 'Porträts mit freigegebenem Zitat' }, { id: 'behind_the_scenes', label: 'Hinter den Kulissen', description: 'Einblicke in die Arbeit' }, { id: 'new_offer', label: 'Neues Angebot', description: 'Neue Kurse und Möglichkeiten' }, { id: 'event', label: 'Veranstaltung', description: 'Fest, Turnier oder Vereinsabend' },
  { id: 'celebration', label: 'Feier & Erfolg', description: 'Ein bestätigter Anlass' }, { id: 'member_recruitment', label: 'Mitglieder gewinnen', description: 'Menschen einladen' }, { id: 'sponsor', label: 'Partner & Sponsoren', description: 'Unterstützung sichtbar machen' }, { id: 'education_tip', label: 'Wissen & Tipp', description: 'Konkretes Wissen teilen' },
  { id: 'match_announcement', label: 'Spielankündigung', description: 'Gegner, Zeit und Ort' }, { id: 'match_result', label: 'Spielergebnis', description: 'Teams und Ergebnis' }, { id: 'freeform', label: 'Eigene Geschichte', description: 'Wenn keine Vorlage passt' },
]
const goals: { id: CommunicationGoal; label: string }[] = [{ id: 'inform', label: 'Informieren' }, { id: 'inspire', label: 'Inspirieren' }, { id: 'thank', label: 'Danken' }, { id: 'invite', label: 'Einladen' }, { id: 'recruit', label: 'Gewinnen' }, { id: 'educate', label: 'Wissen teilen' }, { id: 'strengthen_community', label: 'Gemeinschaft stärken' }]
const availableFormats: { id: OutputFormat; label: string }[] = [{ id: 'feed_image', label: 'Feed-Bild' }, { id: 'carousel', label: 'Carousel' }, { id: 'story', label: 'Story' }, { id: 'reel', label: 'Reel-Entwurf' }]
const facts = computed<Record<string, string | number | boolean>>(() => ({ ...prefilledFacts.value, ...Object.fromEntries(Object.entries({ title: form.title, date: form.date, location: form.location, audience: form.audience }).filter(([, value]) => value.trim())) }))
function toggleFormat(format: OutputFormat) { formats.value = formats.value.includes(format) ? formats.value.filter((item) => item !== format) : [...formats.value, format] }
// Trustworthy structured Fakten (Spielplan/Kalender) bleiben schreibgeschuetzt -- match_announcement/
// match_result haben dafuer keine passenden Formularfelder, "event" prefillt title/location direkt.
const factLabels: Record<string, string> = { opponent: 'Gegner', date: 'Termin', location: 'Ort', homeTeam: 'Heimteam', awayTeam: 'Auswärtsteam', homeScore: 'Tore Heim', awayScore: 'Tore Auswärts', title: 'Titel' }
const summaryFacts = computed(() => {
  const skip = selectedPreset.value === 'event' ? ['title', 'location'] : []
  return Object.entries(prefilledFacts.value).filter(([key]) => !skip.includes(key)).map(([key, value]) => ({ key, label: factLabels[key] ?? key, value }))
})
async function createPreview() {
  if (!formats.value.length) { apiNotice.value = 'Wähle mindestens ein Ausgabeformat.'; return }
  if (!scope.value?.organizationId || !scope.value.departmentId) { apiNotice.value = 'Bitte wähle zuerst Verein und Abteilung.'; return }
  loading.value = true; apiNotice.value = ''
  const body = { organizationId: scope.value.organizationId, departmentId: scope.value.departmentId, presetSlug: selectedPreset.value, communicationGoal: goal.value, requestedFormats: formats.value, sourceMaterial: { facts: facts.value, observations: form.observation.trim() ? [form.observation.trim()] : [], quotes: form.quote.trim() ? [{ text: form.quote.trim(), approved: true }] : [], doNotMention: form.doNotMention.trim() ? [form.doNotMention.trim()] : [] }, ...(fixtureId.value ? { fixtureId: fixtureId.value } : {}), ...(clubEventId.value ? { clubEventId: clubEventId.value } : {}) }
  try {
    const { data } = await useSupabaseClient().auth.getSession()
    const accessToken = data.session?.access_token
    if (!accessToken) throw new Error('not_authenticated')
    const response = await $fetch<{ preview: GeneratedPost }>(`${config.public.apiBase}/v1/submissions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}` },
      body,
    })
    preview.value = response.preview
    step.value = 4
  } catch {
    apiNotice.value = 'Die Submission konnte nicht gesendet werden. Bitte erneut versuchen.'
  } finally { loading.value = false }
}

function mapFixtureRow(row: Record<string, unknown>) {
  return FixtureSchema.parse({
    id: row.id, organizationId: row.organization_id, departmentId: row.department_id, teamId: row.team_id,
    kind: row.kind, competition: row.competition, isHome: row.is_home, ownTeamLabel: row.own_team_label,
    opponentName: row.opponent_name, kickoffAt: row.kickoff_at, kickoffTimeConfirmed: row.kickoff_time_confirmed,
    venueName: row.venue_name, venueAddress: row.venue_address, status: row.status,
    homeScore: row.home_score, awayScore: row.away_score, note: row.note,
    announcementDismissedAt: row.announcement_dismissed_at, resultDismissedAt: row.result_dismissed_at,
    sourceId: row.source_id, sourceUpdatedAt: row.source_updated_at, createdAt: row.created_at, updatedAt: row.updated_at,
  })
}
function mapClubEventRow(row: Record<string, unknown>) {
  return ClubEventSchema.parse({
    id: row.id, organizationId: row.organization_id, departmentId: row.department_id, teamId: row.team_id,
    title: row.title, description: row.description, category: row.category,
    startsAt: row.starts_at, endsAt: row.ends_at, allDay: row.all_day,
    locationName: row.location_name, locationAddress: row.location_address, registrationUrl: row.registration_url,
    status: row.status, invitationDismissedAt: row.invitation_dismissed_at,
    sourceId: row.source_id, sourceUpdatedAt: row.source_updated_at, createdAt: row.created_at, updatedAt: row.updated_at,
  })
}

// "Zu welchem Anlass?": /erstellen?fixtureId=... bzw. ?clubEventId=... kommt aus dem Kalender
// (Luecke ohne Beitrag) oder dem Anlassvorschlaege-Widget im Dashboard (plans/019, Abschnitt 3).
async function loadOccasion() {
  if (import.meta.server) return
  const queryFixtureId = typeof route.query.fixtureId === 'string' ? route.query.fixtureId : null
  const queryClubEventId = typeof route.query.clubEventId === 'string' ? route.query.clubEventId : null
  if (!queryFixtureId && !queryClubEventId) return
  const supabase = useSupabaseClient()

  if (queryFixtureId) {
    const result = await supabase.from('fixtures').select('id, organization_id, department_id, team_id, kind, competition, is_home, own_team_label, opponent_name, kickoff_at, kickoff_time_confirmed, venue_name, venue_address, status, home_score, away_score, note, announcement_dismissed_at, result_dismissed_at, source_id, source_updated_at, created_at, updated_at').eq('id', queryFixtureId).maybeSingle()
    if (result.error || !result.data) { apiNotice.value = 'Der verknüpfte Spieltermin konnte nicht geladen werden.'; return }
    const outcome = factsFromFixture(mapFixtureRow(result.data), null, timezone.value)
    if (outcome.ok) {
      fixtureId.value = queryFixtureId
      selectedPreset.value = outcome.presetSlug
      prefilledFacts.value = outcome.facts
      step.value = 2
    } else {
      apiNotice.value = `Für diesen Anlass fehlen noch Angaben: ${outcome.missing.join(', ')}`
    }
    return
  }

  const result = await supabase.from('club_events').select('id, organization_id, department_id, team_id, title, description, category, starts_at, ends_at, all_day, location_name, location_address, registration_url, status, invitation_dismissed_at, source_id, source_updated_at, created_at, updated_at').eq('id', queryClubEventId).maybeSingle()
  if (result.error || !result.data) { apiNotice.value = 'Die verknüpfte Veranstaltung konnte nicht geladen werden.'; return }
  const outcome = factsFromClubEvent(mapClubEventRow(result.data), timezone.value)
  if (outcome.ok) {
    clubEventId.value = queryClubEventId
    selectedPreset.value = outcome.presetSlug
    prefilledFacts.value = outcome.facts
    if (typeof outcome.facts.title === 'string') form.title = outcome.facts.title
    if (typeof outcome.facts.location === 'string') form.location = outcome.facts.location
    step.value = 2
  } else {
    apiNotice.value = `Für diesen Anlass fehlen noch Angaben: ${outcome.missing.join(', ')}`
  }
}

await loadOccasion()
</script>

<template>
  <div class="min-h-screen bg-[#f6f4ec]"><div class="mx-auto max-w-[1040px] px-5 py-7 sm:px-8 lg:py-10">
    <header class="mb-8 flex items-center justify-between"><NuxtLink to="/" class="focus-ring flex items-center gap-2 rounded-lg text-xs font-semibold text-[#69716c]"><ArrowLeft :size="15" /> Zur Übersicht</NuxtLink><button class="focus-ring rounded-lg p-2 text-[#737a75]" aria-label="Abbrechen" @click="navigateTo('/')"><X :size="18" /></button></header>
    <div v-if="step < 4" class="mx-auto max-w-[880px]"><div class="mb-8 text-center"><div class="eyebrow mb-3">Schritt {{ step }} von 3</div><h1 class="font-display text-3xl font-extrabold tracking-[-.045em]">{{ step === 1 ? 'Was gibt es zu erzählen?' : step === 2 ? 'Wofür soll der Beitrag wirken?' : 'Gib nur sichere Quellen an.' }}</h1><p class="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-[#717973]">Die KI formuliert; sie ergänzt keine Ereignisse, Aussagen oder Personen.</p></div>
      <div v-if="step === 1" class="grid gap-3 sm:grid-cols-2"><button v-for="preset in presets" :key="preset.id" class="focus-ring rounded-2xl border bg-white p-4 text-left" :class="selectedPreset === preset.id ? 'border-forest ring-2 ring-forest/10' : 'border-[#e0e1da]'" @click="selectedPreset = preset.id"><span class="block font-display text-sm font-bold">{{ preset.label }}</span><span class="mt-1 block text-[11px] text-[#7a817c]">{{ preset.description }}</span></button></div>
      <div v-else-if="step === 2" class="card grid gap-5 p-5 sm:p-7"><div><span class="mb-2 block text-xs font-semibold">Kommunikationsziel</span><div class="flex flex-wrap gap-2"><button v-for="item in goals" :key="item.id" class="focus-ring rounded-full border px-3 py-2 text-xs font-semibold" :class="goal === item.id ? 'border-forest bg-forest text-white' : 'border-[#dfe0d9]'" @click="goal = item.id">{{ item.label }}</button></div></div><div><span class="mb-2 block text-xs font-semibold">Ausgabeformate</span><div class="flex flex-wrap gap-2"><button v-for="item in availableFormats" :key="item.id" class="focus-ring rounded-full border px-3 py-2 text-xs font-semibold" :class="formats.includes(item.id) ? 'border-forest bg-[#eff4e6] text-forest' : 'border-[#dfe0d9]'" @click="toggleFormat(item.id)">{{ item.label }}</button></div></div></div>
      <div v-else class="card grid gap-4 p-5 sm:p-7"><div v-if="summaryFacts.length" class="rounded-xl bg-sky-50 p-3 text-[11px] text-sky-900"><span class="mb-1 block font-semibold">{{ fixtureId ? 'Aus dem Spielplan übernommen' : 'Aus dem Kalender übernommen' }}</span><span v-for="fact in summaryFacts" :key="fact.key" class="mr-3 inline-block">{{ fact.label }}: <strong>{{ fact.value }}</strong></span></div><label><span class="mb-2 block text-xs font-semibold">Bestätigte Beobachtung</span><textarea v-model="form.observation" rows="3" class="focus-ring w-full rounded-xl border border-[#dfe0d9] p-3 text-sm" placeholder="z. B. Heute haben die Kinder Balancieren und Werfen geübt." /></label><div class="grid gap-4 sm:grid-cols-2"><label><span class="mb-2 block text-xs font-semibold">Titel oder Anlass</span><input v-model="form.title" class="focus-ring w-full rounded-xl border border-[#dfe0d9] p-3 text-sm" /></label><label><span class="mb-2 block text-xs font-semibold">Zielgruppe</span><input v-model="form.audience" class="focus-ring w-full rounded-xl border border-[#dfe0d9] p-3 text-sm" /></label><label><span class="mb-2 block text-xs font-semibold">Datum</span><input v-model="form.date" type="date" class="focus-ring w-full rounded-xl border border-[#dfe0d9] p-3 text-sm" /></label><label><span class="mb-2 block text-xs font-semibold">Ort oder Kontakt</span><input v-model="form.location" class="focus-ring w-full rounded-xl border border-[#dfe0d9] p-3 text-sm" /></label></div><label><span class="mb-2 block text-xs font-semibold">Ausdrücklich freigegebenes Zitat</span><input v-model="form.quote" class="focus-ring w-full rounded-xl border border-[#dfe0d9] p-3 text-sm" /></label><label><span class="mb-2 block text-xs font-semibold">Nicht erwähnen</span><input v-model="form.doNotMention" class="focus-ring w-full rounded-xl border border-[#dfe0d9] p-3 text-sm" /></label><label class="focus-ring flex cursor-pointer flex-col items-center rounded-2xl border border-dashed border-[#cfd2cb] px-6 py-6 text-center"><input type="file" class="sr-only" accept="image/*,video/*" multiple /><UploadCloud :size="22" class="mb-2 text-forest" /><span class="text-xs font-semibold">Medien privat hochladen</span><span class="mt-1 text-[10px] text-[#898f8a]">Der sichere Upload wird nach Auswahl von Verein und Abteilung gestartet.</span></label><div class="flex items-start gap-3 rounded-xl bg-[#eff4e6] p-3 text-[11px] text-[#5d685d]"><ImagePlus :size="16" class="shrink-0 text-forest" /><span>Gesicht verdeckt reduziert Sichtbarkeit, ist aber keine Rechtsgarantie. Minderjährige benötigen eine explizite zusätzliche Prüfung.</span></div></div>
      <p v-if="apiNotice" class="mt-4 text-sm text-amber-800">{{ apiNotice }}</p>
      <div class="mt-7 flex justify-between"><button v-if="step > 1" class="focus-ring rounded-xl border border-[#dadcd4] bg-white px-5 py-3 text-xs font-semibold" @click="step--"><ArrowLeft :size="14" /> Zurück</button><span v-else /><button v-if="step < 3" class="focus-ring flex items-center gap-2 rounded-xl bg-forest px-6 py-3 text-xs font-bold text-white" @click="step++">Weiter <ArrowRight :size="14" /></button><button v-else class="focus-ring flex items-center gap-2 rounded-xl bg-forest px-6 py-3 text-xs font-bold text-white disabled:opacity-60" :disabled="loading" @click="createPreview"><LoaderCircle v-if="loading" :size="15" class="animate-spin" /><Sparkles v-else :size="15" /> Entwurf erstellen</button></div>
    </div>
    <div v-else-if="preview" class="mx-auto max-w-[920px]"><div class="mb-7"><div class="eyebrow mb-3">Entwurf bereit</div><h1 class="font-display text-3xl font-extrabold tracking-[-.045em]">Euer Beitrag nimmt Form an.</h1><p v-if="apiNotice" class="mt-2 text-sm text-amber-800">{{ apiNotice }}</p></div><div class="grid gap-6 lg:grid-cols-[.85fr_1.15fr]"><div class="aspect-[4/5] rounded-[24px] bg-forest p-8 text-white"><div class="flex h-full flex-col"><span class="eyebrow !text-white/55">Vereinsfunk</span><h2 class="mt-auto font-display text-4xl font-extrabold leading-[.95]">{{ preview.headline }}</h2></div></div><div class="card p-5 sm:p-7"><div class="eyebrow mb-2">Varianten für Instagram & Facebook</div><textarea v-model="preview.caption" rows="10" class="focus-ring w-full rounded-xl border border-[#dfe0d9] p-4 text-sm" /><div class="mt-3 flex flex-wrap gap-1.5"><span v-for="tag in preview.hashtags" :key="tag" class="rounded-full bg-[#eef1e9] px-2.5 py-1 text-[10px] font-semibold text-forest">{{ tag }}</span></div><div class="mt-5 rounded-xl bg-emerald-50 p-3 text-[11px] text-emerald-800"><strong>Faktencheck:</strong> {{ preview.verifiedFacts.length }} Aussagen belegt · {{ preview.missingFacts.length }} offen</div><button class="focus-ring mt-6 w-full rounded-xl bg-forest px-4 py-3 text-xs font-bold text-white" @click="navigateTo('/freigaben')"><Check :size="14" /> Zur Freigabe geben</button></div></div></div>
  </div></div>
</template>
