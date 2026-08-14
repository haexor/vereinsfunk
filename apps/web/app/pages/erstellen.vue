<script setup lang="ts">
import { Check, LoaderCircle, RefreshCw, Sparkles } from '@lucide/vue'
import { SocialPlatformSchema, TEXT_GENERATION_DEFAULT_TEMPERATURE, TEXT_GENERATION_TEMPERATURE_STEPS, TextGenerationCapabilitiesSchema, TextGenerationPlatformAvailabilitySchema, TextGenerationTemperatureSchema, type SocialPlatform, type TextGenerationPlatformAvailability } from '@vereinsfunk/contracts'
import { z } from 'zod'

type Profile = { id: string | null; slug: string; kind: 'system' | 'persona' | 'custom'; name: string; description: string }
type Candidate = { id: string; status: string; generated_content: { headline: string; caption: string; hashtags: string[]; verifiedFacts: string[]; missingFacts: string[] } | null; failure_code: string | null; triggered_by: 'member' | 'automatic_recovery' }
const PLATFORM_LABELS: Record<SocialPlatform, string> = { instagram: 'Instagram', facebook: 'Facebook' }
const PLATFORM_UNAVAILABLE_REASONS: Record<'no_channel' | 'restricted_by_policy', string> = {
  no_channel: 'Kein Kanal eingerichtet.',
  restricted_by_policy: 'Durch eine Richtlinie ausgeschlossen.',
}
const api = useApiClient()
const session = await useSession()
const scope = await useScope()
const notice = ref('')
const submitting = ref(false)
const sessionId = ref<string | null>(null)
const candidate = ref<Candidate | null>(null)
const profiles = ref<Profile[]>([])
const selectedProfile = ref<string>('klar_erklaerend')
// Konservativer Default: bis die Antwort da ist (oder falls sie fehlschlaegt), bleibt der Regler
// verborgen statt einen womoeglich wirkungslosen Regler anzuzeigen (Plan 042, PR 3 Step 1).
const temperatureSupported = ref(false)
const temperature = ref<number>(TEXT_GENERATION_DEFAULT_TEMPERATURE)
const platforms = ref<TextGenerationPlatformAvailability[]>([])
const selectedPlatforms = ref<SocialPlatform[]>([])
const PROFILE_GROUP_LABELS = { system: 'Basis-Stile', persona: 'Personas', custom: 'Eigene Profile' } as const
const profileGroups = computed(() => (['system', 'persona', 'custom'] as const).map((kind) => ({ label: PROFILE_GROUP_LABELS[kind], items: profiles.value.filter((profile) => profile.kind === kind) })).filter((group) => group.items.length))
const presetSlug = ref('training_insight')
const communicationGoal = ref('inform')
const factsText = ref('')
const observation = ref('')
const quote = ref('')
const doNotMention = ref('')
const revisionInstruction = ref('')
const draftKey = computed(() => session.value && scope.value?.organizationId && scope.value.departmentId ? `vf:text-draft:${session.value.userId}:${scope.value.organizationId}:${scope.value.departmentId}` : null)
let restoringDraft = false

function sourceMaterial() {
  const facts = Object.fromEntries(factsText.value.split('\n').map((line) => line.split(':')).filter(([key, value]) => key?.trim() && value?.trim()).map(([key, ...rest]) => [key!.trim(), rest.join(':').trim()]))
  return { facts, observations: observation.value.trim() ? [observation.value.trim()] : [], quotes: quote.value.trim() ? [{ text: quote.value.trim(), approved: true }] : [], doNotMention: doNotMention.value.trim() ? doNotMention.value.split('\n').map((value) => value.trim()).filter(Boolean) : [] }
}
function persistDraft() {
  if (restoringDraft || !import.meta.client || !draftKey.value) return
  localStorage.setItem(draftKey.value, JSON.stringify({ presetSlug: presetSlug.value, communicationGoal: communicationGoal.value, factsText: factsText.value, observation: observation.value, quote: quote.value, doNotMention: doNotMention.value, selectedProfile: selectedProfile.value, temperature: temperature.value, selectedPlatforms: selectedPlatforms.value }))
}
function clearDraft() { if (import.meta.client && draftKey.value) localStorage.removeItem(draftKey.value) }
function restoreDraft() {
  if (!import.meta.client || !draftKey.value) return
  try {
    const raw = localStorage.getItem(draftKey.value); if (!raw) return
    const draft = z.object({ presetSlug: z.string(), communicationGoal: z.string(), factsText: z.string(), observation: z.string(), quote: z.string(), doNotMention: z.string(), selectedProfile: z.string(), temperature: TextGenerationTemperatureSchema.default(TEXT_GENERATION_DEFAULT_TEMPERATURE), selectedPlatforms: z.array(SocialPlatformSchema).default([]) }).parse(JSON.parse(raw))
    presetSlug.value = draft.presetSlug; communicationGoal.value = draft.communicationGoal; factsText.value = draft.factsText; observation.value = draft.observation; quote.value = draft.quote; doNotMention.value = draft.doNotMention; selectedProfile.value = draft.selectedProfile; temperature.value = draft.temperature
    // Nur uebernehmen, was laut der zuletzt geladenen Verfuegbarkeit noch anhakbar ist -- ein Kanal
    // kann seit dem letzten Entwurf entfernt worden sein.
    if (draft.selectedPlatforms.length) selectedPlatforms.value = draft.selectedPlatforms.filter((platform) => platforms.value.some((entry) => entry.platform === platform && entry.available))
  } catch { clearDraft() }
}
watch([presetSlug, communicationGoal, factsText, observation, quote, doNotMention, selectedProfile, temperature, selectedPlatforms], persistDraft, { flush: 'sync', deep: true })
watch(() => `${session.value?.userId ?? ''}:${scope.value?.organizationId ?? ''}:${scope.value?.departmentId ?? ''}`, async () => { restoringDraft = true; sessionId.value = null; candidate.value = null; profiles.value = []; presetSlug.value = 'training_insight'; communicationGoal.value = 'inform'; selectedProfile.value = 'klar_erklaerend'; factsText.value = ''; observation.value = ''; quote.value = ''; doNotMention.value = ''; revisionInstruction.value = ''; temperature.value = TEXT_GENERATION_DEFAULT_TEMPERATURE; platforms.value = []; selectedPlatforms.value = []; await Promise.all([loadProfiles(), loadPlatformAvailability()]); restoreDraft(); restoringDraft = false })

async function loadProfiles() {
  if (!scope.value?.organizationId || !scope.value.departmentId) return
  try {
    const response = await api.request('/v1/content-style-profiles', { query: { organizationId: scope.value.organizationId, departmentId: scope.value.departmentId } }, z.object({ profiles: z.array(z.object({ id: z.string().nullable(), slug: z.string(), kind: z.enum(['system', 'persona', 'custom']), name: z.string(), description: z.string() }).passthrough()) }))
    profiles.value = response.profiles
  } catch { notice.value = 'Stilprofile konnten nicht geladen werden.' }
}

async function loadCapabilities() {
  try {
    const response = await api.request('/v1/text-generation-capabilities', {}, TextGenerationCapabilitiesSchema)
    temperatureSupported.value = response.temperatureSupported
  } catch { temperatureSupported.value = false }
}

async function loadPlatformAvailability() {
  if (!scope.value?.organizationId || !scope.value.departmentId) return
  try {
    const response = await api.request('/v1/text-generation-platforms', { query: { organizationId: scope.value.organizationId, departmentId: scope.value.departmentId } }, z.array(TextGenerationPlatformAvailabilitySchema))
    platforms.value = response
    selectedPlatforms.value = response.filter((entry) => entry.available).map((entry) => entry.platform)
  } catch { notice.value = 'Zielplattformen konnten nicht geladen werden.' }
}
async function refreshSession() {
  if (!sessionId.value) return
  const response = await api.request(`/v1/text-workshop/sessions/${sessionId.value}`, {}, z.object({ candidates: z.array(z.object({ id: z.string(), status: z.string(), generated_content: z.object({ headline: z.string(), caption: z.string(), hashtags: z.array(z.string()), verifiedFacts: z.array(z.string()), missingFacts: z.array(z.string()) }).nullable(), failure_code: z.string().nullable(), triggered_by: z.enum(['member', 'automatic_recovery']) })) }).passthrough())
  candidate.value = response.candidates[0] ?? null
  if (candidate.value?.status === 'ready') clearDraft()
}
async function createCandidate() {
  if (!scope.value?.organizationId || !scope.value.departmentId) { notice.value = 'Bitte wähle Verein und Abteilung.'; return }
  if (!Object.keys(sourceMaterial().facts).length && !observation.value.trim() && !quote.value.trim()) { notice.value = 'Gib mindestens eine bestätigte Tatsache, Beobachtung oder ein freigegebenes Zitat an.'; return }
  if (!selectedPlatforms.value.length) { notice.value = 'Bitte wähle mindestens eine Zielplattform.'; return }
  submitting.value = true; notice.value = ''
  try {
    const selected = profiles.value.find((profile) => (profile.id ?? profile.slug) === selectedProfile.value)
    if (!selected) { selectedProfile.value = 'klar_erklaerend'; notice.value = 'Das gewählte Stilprofil ist nicht mehr verfügbar. Bitte wähle erneut.'; submitting.value = false; return }
    const profileChoice = selected.kind === 'custom' ? { styleProfileId: selected.id } : selected.kind === 'persona' ? { personaSlug: selected.slug } : { systemStyleProfileSlug: selected.slug }
    const created = await api.request('/v1/text-workshop/sessions', {
      method: 'POST',
      body: {
        organizationId: scope.value.organizationId, departmentId: scope.value.departmentId, presetSlug: presetSlug.value, communicationGoal: communicationGoal.value, requestedFormats: ['text_post'],
        ...profileChoice, sourceMaterial: sourceMaterial(), targetPlatforms: selectedPlatforms.value,
        ...(temperatureSupported.value ? { temperature: temperature.value } : {}),
      },
    }, z.object({ sessionId: z.string(), candidateId: z.string() }))
    sessionId.value = created.sessionId; candidate.value = { id: created.candidateId, status: 'pending', generated_content: null, failure_code: null, triggered_by: 'member' }
    await refreshSession()
  } catch (error) {
    const code = (error as { data?: { error?: string } })?.data?.error
    notice.value = code === 'platform_not_available' ? 'Eine gewählte Plattform ist nicht mehr verfügbar. Bitte Auswahl aktualisieren.' : 'Die Textgeneration konnte nicht gestartet werden.'
  } finally { submitting.value = false }
}
async function acceptCandidate() {
  if (!candidate.value) return
  try { const accepted = await api.request(`/v1/text-workshop/candidates/${candidate.value.id}/accept`, { method: 'POST' }, z.union([z.object({ postId: z.string(), postVersionId: z.string(), alreadyAccepted: z.literal(false) }), z.object({ postVersionId: z.string(), alreadyAccepted: z.literal(true) })])); await navigateTo(`/freigaben?postVersionId=${accepted.postVersionId}`) } catch { notice.value = 'Der Kandidat konnte nicht übernommen werden.' }
}
const selectedTemperatureStep = computed(() => TEXT_GENERATION_TEMPERATURE_STEPS.find((step) => step.value === temperature.value) ?? TEXT_GENERATION_TEMPERATURE_STEPS[1])
function togglePlatform(platform: SocialPlatform) {
  selectedPlatforms.value = selectedPlatforms.value.includes(platform) ? selectedPlatforms.value.filter((entry) => entry !== platform) : [...selectedPlatforms.value, platform]
}
async function reviseCandidate() {
  if (!sessionId.value || !revisionInstruction.value.trim()) return
  submitting.value = true; notice.value = ''
  try {
    const created = await api.request(`/v1/text-workshop/sessions/${sessionId.value}/generations`, { method: 'POST', body: { generationIntent: 'revise', revisionInstruction: revisionInstruction.value.trim() } }, z.object({ sessionId: z.string(), candidateId: z.string() }))
    candidate.value = { id: created.candidateId, status: 'pending', generated_content: null, failure_code: null, triggered_by: 'member' }
    revisionInstruction.value = ''
    await refreshSession()
  } catch { notice.value = 'Die Überarbeitung konnte nicht gestartet werden.' } finally { submitting.value = false }
}
await Promise.all([loadProfiles(), loadPlatformAvailability(), loadCapabilities()]); restoreDraft()
</script>

<template>
  <main class="mx-auto max-w-3xl px-5 py-8 sm:px-8">
    <header class="mb-7"><div class="eyebrow mb-2">Textwerkstatt</div><h1 class="font-display text-3xl font-extrabold">Aus bestätigten Angaben formulieren</h1><p class="mt-2 text-sm text-[#727a75]">Dieser Pilot erstellt nur Text. Foto- und Videoanhänge sind noch nicht verfügbar und werden nie an das Sprachmodell gesendet.</p></header>
    <section v-if="!sessionId" class="card grid gap-5 p-5 sm:p-7">
      <div class="grid gap-4 sm:grid-cols-2"><label><span class="mb-1 block text-xs font-semibold">Anlass</span><input v-model="presetSlug" class="w-full rounded-xl border p-3 text-sm" placeholder="z. B. training_insight" /></label><label><span class="mb-1 block text-xs font-semibold">Kommunikationsziel</span><select v-model="communicationGoal" class="w-full rounded-xl border p-3 text-sm"><option value="inform">Informieren</option><option value="invite">Einladen</option><option value="thank">Danken</option><option value="recruit">Gewinnen</option><option value="inspire">Inspirieren</option></select></label></div>
      <fieldset><legend class="mb-2 text-xs font-semibold">Stilprofil</legend><div v-for="group in profileGroups" :key="group.label" class="mb-3"><p class="mb-1 text-[11px] font-semibold text-[#9aa096]">{{ group.label }}</p><div class="grid gap-2 sm:grid-cols-2"><button v-for="profile in group.items" :key="profile.slug" class="rounded-xl border p-3 text-left text-sm" :class="selectedProfile === (profile.id ?? profile.slug) ? 'border-forest bg-[#eff4e6]' : ''" @click="selectedProfile = profile.id ?? profile.slug"><strong>{{ profile.name }}</strong><span class="mt-1 block text-xs text-[#737a75]">{{ profile.description }}</span></button></div></div><NuxtLink to="/stilprofile" class="focus-ring text-[11px] font-semibold text-forest underline">Eigene Stilprofile verwalten →</NuxtLink></fieldset>
      <fieldset v-if="platforms.length">
        <legend class="mb-2 text-xs font-semibold">Zielplattformen</legend>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="entry in platforms" :key="entry.platform" type="button"
            class="rounded-xl border px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            :class="selectedPlatforms.includes(entry.platform) ? 'border-forest bg-[#eff4e6]' : ''"
            :disabled="!entry.available"
            :title="entry.reason ? PLATFORM_UNAVAILABLE_REASONS[entry.reason] : undefined"
            @click="togglePlatform(entry.platform)"
          >
            {{ PLATFORM_LABELS[entry.platform] }}
          </button>
        </div>
        <p v-if="platforms.some((entry) => !entry.available)" class="mt-1 text-[11px] font-normal text-[#9aa096]">Ausgegraute Plattformen haben keinen eingerichteten Kanal für diesen Scope.</p>
      </fieldset>
      <fieldset>
        <legend class="mb-2 text-xs font-semibold">Persona-Intensität</legend>
        <div v-if="temperatureSupported" class="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <button
            v-for="step in TEXT_GENERATION_TEMPERATURE_STEPS" :key="step.value" type="button"
            class="rounded-xl border p-2 text-center text-xs font-semibold"
            :class="temperature === step.value ? 'border-forest bg-[#eff4e6]' : ''"
            @click="temperature = step.value"
          >
            {{ step.label }}
          </button>
        </div>
        <p v-if="temperatureSupported" class="mt-1 text-[11px] font-normal text-[#9aa096]">{{ selectedTemperatureStep.hint }}</p>
        <p v-else class="text-[11px] font-normal text-[#9aa096]">Das aktive Sprachmodell unterstützt diese Einstellung nicht.</p>
      </fieldset>
      <label><span class="mb-1 block text-xs font-semibold">Bestätigte Fakten (eine Zeile je „Feld: Wert“)</span><textarea v-model="factsText" rows="4" class="w-full rounded-xl border p-3 text-sm" placeholder="Übung: Passen&#10;Gruppe: U12" /></label>
      <label><span class="mb-1 block text-xs font-semibold">Beobachtung oder Rohtext</span><textarea v-model="observation" rows="3" class="w-full rounded-xl border p-3 text-sm" /></label>
      <div class="grid gap-4 sm:grid-cols-2"><label><span class="mb-1 block text-xs font-semibold">Freigegebenes Zitat</span><input v-model="quote" class="w-full rounded-xl border p-3 text-sm" /></label><label><span class="mb-1 block text-xs font-semibold">Nicht erwähnen (je Zeile)</span><input v-model="doNotMention" class="w-full rounded-xl border p-3 text-sm" /></label></div>
      <button class="inline-flex items-center justify-center gap-2 rounded-xl bg-forest px-5 py-3 text-sm font-bold text-white disabled:opacity-60" :disabled="submitting" @click="createCandidate"><LoaderCircle v-if="submitting" class="animate-spin" :size="16" /><Sparkles v-else :size="16" /> Textkandidaten erzeugen</button>
    </section>
    <section v-else class="card p-5 sm:p-7"><div class="flex items-center justify-between"><h2 class="font-display text-xl font-bold">{{ candidate?.status === 'ready' ? 'Textkandidat bereit' : 'Text wird erzeugt' }}</h2><button class="rounded-lg border px-3 py-2 text-xs" @click="refreshSession"><RefreshCw :size="14" /> Aktualisieren</button></div><p v-if="candidate && candidate.status !== 'ready'" class="mt-4 text-sm text-[#727a75]">Der Worker verarbeitet die Anfrage im Hintergrund. Diese Seite enthält keinen Prompt und keine Providerdaten.</p><p v-if="candidate?.triggered_by === 'automatic_recovery'" class="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">Diese Version wurde nach einem technischen Fehler automatisch neu erzeugt.</p><template v-if="candidate?.generated_content"><textarea :value="candidate.generated_content.caption" readonly rows="10" class="mt-5 w-full rounded-xl border p-3 text-sm" /><div class="mt-3 rounded-xl bg-emerald-50 p-3 text-xs text-emerald-900">{{ candidate.generated_content.verifiedFacts.length }} belegte Angaben · {{ candidate.generated_content.missingFacts.length }} offene Angaben</div><label class="mt-5 block"><span class="mb-1 block text-xs font-semibold">Überarbeitungswunsch</span><textarea v-model="revisionInstruction" rows="2" maxlength="500" class="w-full rounded-xl border p-3 text-sm" placeholder="z. B. kürzer und mit direkter Einladung" /></label><button class="mt-3 rounded-xl border px-4 py-2 text-sm font-semibold disabled:opacity-60" :disabled="submitting || !revisionInstruction.trim()" @click="reviseCandidate"><RefreshCw :size="15" class="mr-1 inline" /> Überarbeiten</button><button class="mt-5 inline-flex items-center gap-2 rounded-xl bg-forest px-5 py-3 text-sm font-bold text-white" @click="acceptCandidate"><Check :size="16" /> Übernehmen und zur Freigabe</button></template><p v-if="candidate?.status === 'failed'" class="mt-4 text-sm text-red-700">Die Anfrage konnte nicht verarbeitet werden. Bitte prüfe die bestätigten Angaben und starte eine neue Sitzung.</p></section>
    <p v-if="notice" class="mt-4 text-sm text-amber-800">{{ notice }}</p>
  </main>
</template>
