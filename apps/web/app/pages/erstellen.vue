<script setup lang="ts">
import { Check, LoaderCircle, RefreshCw, Save, Sparkles } from '@lucide/vue'
import { MaxCharactersSchema, RequestApprovalResponseSchema, SocialPlatformSchema, SourceMaterialSchema, TEXT_GENERATION_DEFAULT_TEMPERATURE, TextGenerationPlatformAvailabilitySchema, UuidSchema, type SocialPlatform, type TextGenerationPlatformAvailability } from '@vereinsfunk/contracts'
import { z } from 'zod'

type Profile = { id: string | null; slug: string; kind: 'system' | 'persona' | 'custom'; name: string; description: string }
type Candidate = { id: string; status: string; generated_content: { headline: string; caption: string; hashtags: string[]; verifiedFacts: string[]; missingFacts: string[] } | null; failure_code: string | null; triggered_by: 'member' | 'automatic_recovery' }
// Geteilt von refreshSession() und loadDraftFromPost() (Wiedereinstieg aus der Beitraege-Liste) --
// dieselbe Kandidaten-Antwortform, einmal benannt statt zweimal inline dupliziert.
const CandidateSchema = z.object({ id: z.string(), status: z.string(), generated_content: z.object({ headline: z.string(), caption: z.string(), hashtags: z.array(z.string()), verifiedFacts: z.array(z.string()), missingFacts: z.array(z.string()) }).nullable(), failure_code: z.string().nullable(), triggered_by: z.enum(['member', 'automatic_recovery']) })
// Fuer den Wiedereinstieg per postId (GET /v1/text-workshop/sessions?postId=): style_profile_snapshot
// traegt bei Personas/Systemprofilen zusaetzlich zu StyleProfileSnapshotSchema ein "slug"-Feld
// (routes/content.ts), das der exportierte Vertrag nicht kennt -- deshalb hier lose statt importiert.
const CompositionSessionDraftSchema = z.object({
  id: z.string(), communication_goal: z.string(), source_material: SourceMaterialSchema,
  style_profile_id: z.string().nullable(), style_profile_snapshot: z.object({ slug: z.string().optional() }).passthrough(),
  target_platforms: z.array(SocialPlatformSchema),
})
// Nur die drei Faelle, die auf diesem Weg realistisch auftreten (routes/approvals.ts,
// request_approval-RPC-Fehlermeldungen); die uebrigen (invalid_reviewer_snapshot,
// invalid_stage_positions, empty_reviewer_snapshot) sind laut deren eigenen Kommentaren ueber
// diese Route nicht erreichbar und fallen auf die generische Meldung unten zurueck.
const REQUEST_APPROVAL_ERROR_MESSAGES: Record<string, string> = {
  forbidden: 'Du hast keine Berechtigung, diesen Beitrag zur Freigabe einzureichen.',
  invalid_status: 'Dieser Beitrag wurde bereits zur Freigabe eingereicht oder befindet sich nicht mehr im Entwurf.',
  minor_stage_required: 'Für diesen Beitrag ist eine besondere Freigabestufe für minderjährige Verfasser:innen nötig, die sich aktuell nicht auflösen lässt. Bitte an eine Vereinsverwaltung wenden.',
  review_required: 'Laut Richtlinie ist für diesen Beitrag eine Prüfung nötig, es ist aber niemand zum Prüfen hinterlegt. Bitte an eine Vereinsverwaltung wenden.',
  unfulfillable_stage: 'Für diesen Beitrag lässt sich aktuell keine gültige Freigaberoute bilden. Bitte an eine Vereinsverwaltung wenden.',
  only_author_as_reviewer: 'Du bist die einzige mögliche Prüfperson für diesen Beitrag. Bitte an eine Vereinsverwaltung wenden.',
}
type PlatformUnavailableReason = 'no_channel' | 'restricted_by_policy'
const PLATFORM_UNAVAILABLE_REASONS: Record<PlatformUnavailableReason, string> = {
  no_channel: 'Kein Kanal eingerichtet.',
  restricted_by_policy: 'Durch eine Richtlinie ausgeschlossen.',
}
// Der Kurztext oben steht nur im title-Attribut und ist damit nur beim Darauffahren zu lesen --
// erklaert wird sichtbar, und zwar der Grund, der tatsaechlich vorliegt. Ein pauschales "kein Kanal
// eingerichtet" schickte ein Mitglied einen Kanal anlegen, den es laengst gibt (Review dieses PRs).
const PLATFORM_UNAVAILABLE_EXPLANATIONS: Record<PlatformUnavailableReason, string> = {
  no_channel: 'Ausgegraut: für diese Plattform ist in diesem Bereich kein Kanal eingerichtet.',
  restricted_by_policy: 'Ausgegraut: für diese Plattform gibt es einen Kanal, eine Richtlinie schließt ihn hier aber aus.',
}
const api = useApiClient()
const route = useRoute()
const session = await useSession()
const scope = await useScope()
const notice = ref('')
const submitting = ref(false)
const sessionId = ref<string | null>(null)
const candidate = ref<Candidate | null>(null)
const profiles = ref<Profile[]>([])
const selectedProfile = ref<string>('klar_erklaerend')
const platforms = ref<TextGenerationPlatformAvailability[]>([])
const selectedPlatforms = ref<SocialPlatform[]>([])
const maxCharactersOverride = ref('')
// Plan 045, PR 0 Schritt 3: null bis PhotoAttachment die Personen-Pruefung abgeschlossen hat.
const mediaAssetId = ref<string | null>(null)
// Nur zwei Gruppen in der Dropdown-Liste: System- und eigene Profile sind beides "Stil" (der
// Unterschied ist fuer die Auswahl selbst nicht relevant), Personas bleiben separat.
const PROFILE_GROUPS = [
  { label: 'Stil', kinds: ['system', 'custom'] as const },
  { label: 'Personas', kinds: ['persona'] as const },
] as const
const profileGroups = computed(() => PROFILE_GROUPS.map((group) => ({ label: group.label, items: group.kinds.flatMap((kind) => profiles.value.filter((profile) => profile.kind === kind)) })).filter((group) => group.items.length))
const profileSelectGroups = computed(() => profileGroups.value.map((group) => ({ label: group.label, items: group.items.map((profile) => ({ value: profile.id ?? profile.slug, label: profile.name, description: profile.description })) })))
const communicationGoal = ref('inform')
const factsText = ref('')
const observation = ref('')
const doNotMention = ref('')
const revisionInstruction = ref('')
const serverDraftId = ref<string | null>(null)
const draftSaveState = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')
const draftKey = computed(() => session.value && scope.value?.organizationId && scope.value.departmentId ? `vf:text-draft:${session.value.userId}:${scope.value.organizationId}:${scope.value.departmentId}` : null)
let restoringDraft = false
let draftSaveTimer: ReturnType<typeof setTimeout> | undefined
let serverDraftSaveChain: Promise<void> = Promise.resolve()
let latestServerDraftSave = 0

function sourceMaterial() {
  const facts = Object.fromEntries(factsText.value.split('\n').map((line) => line.split(':')).filter(([key, value]) => key?.trim() && value?.trim()).map(([key, ...rest]) => [key!.trim(), rest.join(':').trim()]))
  return { facts, observations: observation.value.trim() ? [observation.value.trim()] : [], quotes: [], doNotMention: doNotMention.value.trim() ? doNotMention.value.split('\n').map((value) => value.trim()).filter(Boolean) : [] }
}
function persistDraft() {
  if (restoringDraft || !import.meta.client || !draftKey.value) return
  localStorage.setItem(draftKey.value, JSON.stringify({ communicationGoal: communicationGoal.value, factsText: factsText.value, observation: observation.value, doNotMention: doNotMention.value, selectedProfile: selectedProfile.value, temperature: TEXT_GENERATION_DEFAULT_TEMPERATURE, selectedPlatforms: selectedPlatforms.value, maxCharactersOverride: maxCharactersOverride.value }))
}
function clearDraft() { if (import.meta.client && draftKey.value) localStorage.removeItem(draftKey.value) }
function draftPayload() {
  return { communicationGoal: communicationGoal.value, factsText: factsText.value, observation: observation.value, doNotMention: doNotMention.value, selectedProfile: selectedProfile.value, temperature: TEXT_GENERATION_DEFAULT_TEMPERATURE, selectedPlatforms: selectedPlatforms.value, maxCharactersOverride: maxCharactersOverride.value }
}
function hasDraftContent() {
  const payload = draftPayload()
  return Boolean(payload.factsText.trim() || payload.observation.trim() || payload.doNotMention.trim() || payload.communicationGoal !== 'inform' || payload.selectedProfile !== 'klar_erklaerend' || payload.selectedPlatforms.length || payload.maxCharactersOverride.trim())
}
async function saveServerDraft({ explicit = false, required = false }: { explicit?: boolean; required?: boolean } = {}): Promise<boolean> {
  if (draftSaveTimer) { clearTimeout(draftSaveTimer); draftSaveTimer = undefined }
  if (restoringDraft || !scope.value?.organizationId || !scope.value.departmentId || (!explicit && !hasDraftContent())) return false
  if (!hasDraftContent()) { notice.value = 'Gib zuerst etwas für den Entwurf ein.'; return false }
  if (!serverDraftId.value) serverDraftId.value = crypto.randomUUID()
  const draftId = serverDraftId.value
  const organizationId = scope.value.organizationId
  const departmentId = scope.value.departmentId
  const payload = draftPayload()
  const saveNumber = ++latestServerDraftSave
  draftSaveState.value = 'saving'
  // Capture ID, scope and payload before queuing. Debounced, manual and candidate-triggered
  // saves all use this one chain, so an older request can never finish after a newer payload and
  // overwrite it on the server.
  const queuedSave = serverDraftSaveChain.then(async () => {
    try {
      await api.request(`/v1/text-workshop/drafts/${draftId}`, { method: 'PUT', body: { organizationId, departmentId, payload } }, z.object({ draft: z.object({ id: z.string() }) }))
      if (serverDraftId.value === draftId && saveNumber === latestServerDraftSave) draftSaveState.value = 'saved'
      return true
    } catch {
      if (serverDraftId.value === draftId && saveNumber === latestServerDraftSave) {
        draftSaveState.value = 'error'
      }
      // A required save aborts the next action even when a newer best-effort save is queued.
      // Keep its failure visible; otherwise the action would appear to do nothing.
      if (required || (explicit && serverDraftId.value === draftId && saveNumber === latestServerDraftSave)) notice.value = 'Der Entwurf konnte gerade nicht gespeichert werden. Deine Eingaben bleiben lokal erhalten.'
      return false
    }
  })
  // Keep the queue usable after a failed best-effort save while returning this request's result
  // to callers that must not continue without a durable server draft.
  serverDraftSaveChain = queuedSave.then(() => undefined)
  return queuedSave
}
function queueServerDraftSave() {
  if (restoringDraft || !hasDraftContent()) return
  if (draftSaveTimer) clearTimeout(draftSaveTimer)
  draftSaveTimer = setTimeout(() => { void saveServerDraft() }, 900)
}
function restoreDraft() {
  if (!import.meta.client || !draftKey.value) return
  try {
    const raw = localStorage.getItem(draftKey.value); if (!raw) return
    const draft = z.object({ communicationGoal: z.string(), factsText: z.string(), observation: z.string(), doNotMention: z.string(), selectedProfile: z.string(), selectedPlatforms: z.array(SocialPlatformSchema).default([]), maxCharactersOverride: z.string().default('') }).parse(JSON.parse(raw))
    communicationGoal.value = draft.communicationGoal; factsText.value = draft.factsText; observation.value = draft.observation; doNotMention.value = draft.doNotMention; selectedProfile.value = draft.selectedProfile; maxCharactersOverride.value = draft.maxCharactersOverride
    // Nur uebernehmen, was laut der zuletzt geladenen Verfuegbarkeit noch anhakbar ist -- ein Kanal
    // kann seit dem letzten Entwurf entfernt worden sein.
    if (draft.selectedPlatforms.length) selectedPlatforms.value = draft.selectedPlatforms.filter((platform) => platforms.value.some((entry) => entry.platform === platform && entry.available))
  } catch { clearDraft() }
}
watch([communicationGoal, factsText, observation, doNotMention, selectedProfile, selectedPlatforms, maxCharactersOverride], () => { persistDraft(); queueServerDraftSave() }, { flush: 'sync', deep: true })
watch(() => `${session.value?.userId ?? ''}:${scope.value?.organizationId ?? ''}:${scope.value?.departmentId ?? ''}`, async () => { restoringDraft = true; sessionId.value = null; candidate.value = null; serverDraftId.value = null; profiles.value = []; communicationGoal.value = 'inform'; selectedProfile.value = 'klar_erklaerend'; factsText.value = ''; observation.value = ''; doNotMention.value = ''; revisionInstruction.value = ''; platforms.value = []; selectedPlatforms.value = []; maxCharactersOverride.value = ''; mediaAssetId.value = null; await Promise.all([loadProfiles(), loadPlatformAvailability()]); restoreDraft(); restoringDraft = false })

async function loadProfiles() {
  if (!scope.value?.organizationId || !scope.value.departmentId) return
  try {
    const response = await api.request('/v1/content-style-profiles', { query: { organizationId: scope.value.organizationId, departmentId: scope.value.departmentId } }, z.object({ profiles: z.array(z.object({ id: z.string().nullable(), slug: z.string(), kind: z.enum(['system', 'persona', 'custom']), name: z.string(), description: z.string() }).passthrough()) }))
    profiles.value = response.profiles
  } catch { notice.value = 'Stilprofile konnten nicht geladen werden.' }
}

async function loadPlatformAvailability() {
  if (!scope.value?.organizationId || !scope.value.departmentId) return
  try {
    const response = await api.request('/v1/text-generation-platforms', { query: { organizationId: scope.value.organizationId, departmentId: scope.value.departmentId } }, z.array(TextGenerationPlatformAvailabilitySchema))
    platforms.value = response
    // Plan 044, PR 1 Step 3: keine Plattform ist ab Werk vorausgewaehlt -- angehakt wird nur, was
    // der Verein/die Abteilung als eigene Vorgabe gesetzt hat (isDefault, bereits mit der
    // Verfuegbarkeit geschnitten). Ohne Vorgabe startet die Auswahl leer.
    selectedPlatforms.value = response.filter((entry) => entry.isDefault).map((entry) => entry.platform)
  } catch { notice.value = 'Zielplattformen konnten nicht geladen werden.' }
}
async function refreshSession() {
  if (!sessionId.value) return
  const response = await api.request(`/v1/text-workshop/sessions/${sessionId.value}`, {}, z.object({ candidates: z.array(CandidateSchema) }).passthrough())
  candidate.value = response.candidates[0] ?? null
}
async function loadServerDraft(draftId: string) {
  try {
    const response = await api.request(`/v1/text-workshop/drafts/${draftId}`, {}, z.object({ draft: z.object({ id: z.string(), payload: z.object({ communicationGoal: z.string(), factsText: z.string(), observation: z.string(), doNotMention: z.string(), selectedProfile: z.string(), selectedPlatforms: z.array(SocialPlatformSchema), maxCharactersOverride: z.string() }) }) }))
    const draft = response.draft
    serverDraftId.value = draft.id
    communicationGoal.value = draft.payload.communicationGoal; factsText.value = draft.payload.factsText; observation.value = draft.payload.observation; doNotMention.value = draft.payload.doNotMention; selectedProfile.value = draft.payload.selectedProfile; maxCharactersOverride.value = draft.payload.maxCharactersOverride
    selectedPlatforms.value = draft.payload.selectedPlatforms.filter((platform) => platforms.value.some((entry) => entry.platform === platform && entry.available))
    persistDraft()
  } catch { notice.value = 'Der Entwurf konnte nicht geladen werden.' }
}
// Wiedereinstieg aus der Beitraege-Liste (?postId=...): laedt die zum Beitrag gehoerende
// composition_session inklusive letztem Kandidaten und befuellt das Formular exakt wie im Entwurf
// gespeichert. Derselbe restoringDraft-Schutz wie bei restoreDraft()/dem Scope-Wechsel oben und aus
// demselben Grund -- der persistDraft-Watcher laeuft mit flush: 'sync' vor jeder einzelnen der
// folgenden Zuweisungen.
async function loadDraftFromPost(postId: string) {
  try {
    const response = await api.request('/v1/text-workshop/sessions', { query: { postId } }, z.object({ session: CompositionSessionDraftSchema, candidates: z.array(CandidateSchema) }))
    const { session: draftSession, candidates } = response
    communicationGoal.value = draftSession.communication_goal
    factsText.value = Object.entries(draftSession.source_material.facts).map(([key, value]) => `${key}: ${value}`).join('\n')
    observation.value = draftSession.source_material.observations[0] ?? ''
    // doNotMention traegt seit der Anlage bereits die Verbotsliste des Vereins/der Abteilung
    // eingemischt (routes/content.ts) -- ein Herauskuerzen hier haette beim erneuten Absenden
    // ohnehin keine Wirkung, die Route mischt sie wieder ein. Bewusst nicht getrennt angezeigt.
    doNotMention.value = draftSession.source_material.doNotMention.join('\n')
    selectedProfile.value = draftSession.style_profile_id ?? draftSession.style_profile_snapshot.slug ?? 'klar_erklaerend'
    // Nur uebernehmen, was laut der zuletzt geladenen Verfuegbarkeit noch anhakbar ist -- derselbe
    // Filter wie in restoreDraft(), ein Kanal kann seither entfernt worden sein.
    selectedPlatforms.value = draftSession.target_platforms.filter((platform) => platforms.value.some((entry) => entry.platform === platform && entry.available))
    // max_characters bewusst NICHT vorbefuellt: die Spalte traegt den nach Minimumbildung mit den
    // gewaehlten Plattformen aufgeloesten Wert (routes/content.ts), nicht zwingend eine eigene
    // Obergrenze, die die Person tatsaechlich eingetragen hatte -- eine Vorbefuellung wuerde hier
    // faelschlich eine eigene Grenze vortaeuschen, die nie gesetzt wurde.
    sessionId.value = draftSession.id
    candidate.value = candidates[0] ?? null
  } catch {
    notice.value = 'Der bisherige Bearbeitungsstand konnte nicht geladen werden. Du kannst hier einen neuen Entwurf beginnen.'
  }
}
function parsedMaxCharactersOverride(): number | undefined | 'invalid' {
  const trimmed = maxCharactersOverride.value.trim()
  if (!trimmed) return undefined
  const parsed = MaxCharactersSchema.safeParse(Number(trimmed))
  return parsed.success ? parsed.data : 'invalid'
}
async function createCandidate() {
  if (!scope.value?.organizationId || !scope.value.departmentId) { notice.value = 'Bitte wähle Verein und Abteilung.'; return }
  if (!Object.keys(sourceMaterial().facts).length && !observation.value.trim()) { notice.value = 'Gib mindestens eine bestätigte Tatsache oder Beobachtung an.'; return }
  if (!selectedPlatforms.value.length) { notice.value = 'Bitte wähle mindestens eine Zielplattform.'; return }
  const maxCharacters = parsedMaxCharactersOverride()
  if (maxCharacters === 'invalid') { notice.value = 'Die maximale Länge muss zwischen 100 und 10.000 Zeichen liegen.'; return }
  submitting.value = true; notice.value = ''
  try {
    if (!(await saveServerDraft({ required: true }))) return
    const selected = profiles.value.find((profile) => (profile.id ?? profile.slug) === selectedProfile.value)
    if (!selected) { selectedProfile.value = 'klar_erklaerend'; notice.value = 'Das gewählte Stilprofil ist nicht mehr verfügbar. Bitte wähle erneut.'; submitting.value = false; return }
    const profileChoice = selected.kind === 'custom' ? { styleProfileId: selected.id } : selected.kind === 'persona' ? { personaSlug: selected.slug } : { systemStyleProfileSlug: selected.slug }
    const created = await api.request('/v1/text-workshop/sessions', {
      method: 'POST',
      body: {
        organizationId: scope.value.organizationId, departmentId: scope.value.departmentId, communicationGoal: communicationGoal.value, requestedFormats: ['text_post'],
        mediaAssetIds: mediaAssetId.value ? [mediaAssetId.value] : [],
        ...profileChoice, sourceMaterial: sourceMaterial(), targetPlatforms: selectedPlatforms.value,
        // Ein weiterer Kandidat der serverseitigen Minimumbildung, keine Ueberschreibung -- die
        // gewaehlten Plattformen bleiben die verbindliche Obergrenze (routes/content.ts).
        ...(maxCharacters !== undefined ? { maxCharacters } : {}),
      },
    }, z.object({ sessionId: UuidSchema, candidateIds: z.array(UuidSchema).min(1) }))
    // Paket 046: eine Anfrage kann mehrere Kandidaten gleichzeitig erzeugen (Ensemble-Groesse, vom
    // Plattform-Admin konfiguriert). Diese Seite zeigt bis zur eigenen Mehrfachauswahl-UI weiterhin
    // nur den ersten -- refreshSession() unten holt ohnehin die ganze Runde nach.
    sessionId.value = created.sessionId; candidate.value = { id: created.candidateIds[0]!, status: 'pending', generated_content: null, failure_code: null, triggered_by: 'member' }
    await refreshSession()
  } catch (error) {
    const code = (error as { data?: { error?: string } })?.data?.error
    if (code === 'platform_not_available') {
      await loadPlatformAvailability()
      notice.value = 'Eine gewählte Plattform ist nicht mehr verfügbar. Bitte Auswahl aktualisieren.'
    } else if (code === 'media_asset_not_reviewed' || code === 'media_asset_not_ready' || code === 'media_asset_not_found') {
      // Die Personen-Pruefung wurde ungueltig, seit PhotoAttachment sie abgeschlossen hat (z. B.
      // eine Markierung wurde in einem anderen Tab geaendert) -- der Trigger in Migration
      // 2026081802 setzt people_reviewed_at in genau diesem Fall automatisch zurueck.
      mediaAssetId.value = null
      notice.value = 'Die Personen-Prüfung des angehängten Fotos ist nicht mehr aktuell. Bitte das Foto erneut prüfen.'
    } else if (code === 'no_active_text_provider') {
      notice.value = 'Aktuell ist kein Sprachmodell für die Textgenerierung hinterlegt. Bitte an eine Vereinsverwaltung wenden.'
    } else {
      notice.value = 'Die Textgeneration konnte nicht gestartet werden.'
    }
  } finally { submitting.value = false }
}
async function acceptCandidate() {
  if (!candidate.value) return
  submitting.value = true; notice.value = ''
  try {
    if (!(await saveServerDraft({ required: true }))) return
    const accepted = await api.request(`/v1/text-workshop/candidates/${candidate.value.id}/accept`, { method: 'POST', body: serverDraftId.value ? { draftId: serverDraftId.value } : {} }, z.union([
      z.object({ postId: z.string(), postVersionId: z.string(), alreadyAccepted: z.literal(false) }),
      z.object({ postVersionId: z.string(), alreadyAccepted: z.literal(true) }),
    ]))
    candidate.value = { ...candidate.value, status: 'accepted' }
    // Uebernehmen und Einreichen sind zwei getrennte, je fuer sich wiederholbare Schritte: der
    // post_version-Datensatz existiert ab hier auch dann, wenn das Einreichen unten scheitert --
    // die Person bleibt auf dieser Seite und kann den Button erneut anklicken (accept liefert dann
    // ueber alreadyAccepted denselben postVersionId zurueck).
    try {
      await api.request(`/v1/post-versions/${accepted.postVersionId}/request-approval`, { method: 'POST' }, RequestApprovalResponseSchema)
      clearDraft()
      serverDraftId.value = null
      await navigateTo('/beitraege')
    } catch (error) {
      const code = (error as { data?: { error?: string } })?.data?.error
      notice.value = REQUEST_APPROVAL_ERROR_MESSAGES[code ?? ''] ?? 'Der Entwurf wurde gespeichert, konnte aber nicht zur Freigabe eingereicht werden.'
    }
  } catch { notice.value = 'Der Kandidat konnte nicht übernommen werden.' } finally { submitting.value = false }
}
// 'accepted' wird seit dem Wiedereinstieg per postId erreichbar: der zuletzt uebernommene
// Kandidat einer wiedereroeffneten Sitzung traegt diesen Status, zeigt aber denselben fertigen
// Text wie 'ready'. Ohne diese Erweiterung behauptete die Ueberschrift faelschlich "wird erzeugt".
const candidateFinished = computed(() => candidate.value?.status === 'ready' || candidate.value?.status === 'accepted')
const unavailableReasons = computed(() => [...new Set(platforms.value.filter((entry) => !entry.available).map((entry) => entry.reason))].filter((reason): reason is PlatformUnavailableReason => reason !== undefined))
function togglePlatform(platform: SocialPlatform) {
  selectedPlatforms.value = selectedPlatforms.value.includes(platform) ? selectedPlatforms.value.filter((entry) => entry !== platform) : [...selectedPlatforms.value, platform]
}
async function reviseCandidate() {
  if (!sessionId.value || !revisionInstruction.value.trim()) return
  submitting.value = true; notice.value = ''
  try {
    const created = await api.request(`/v1/text-workshop/sessions/${sessionId.value}/generations`, { method: 'POST', body: { generationIntent: 'revise', revisionInstruction: revisionInstruction.value.trim() } }, z.object({ sessionId: UuidSchema, candidateIds: z.array(UuidSchema).min(1) }))
    candidate.value = { id: created.candidateIds[0]!, status: 'pending', generated_content: null, failure_code: null, triggered_by: 'member' }
    revisionInstruction.value = ''
    await refreshSession()
  } catch { notice.value = 'Die Überarbeitung konnte nicht gestartet werden.' } finally { submitting.value = false }
}
// Dieselbe restoringDraft-Klammer wie im Scope-Wechsel oben, und aus demselben Grund:
// loadPlatformAvailability() schreibt selectedPlatforms, der persistDraft-Watcher laeuft mit
// flush: 'sync' also noch VOR restoreDraft() -- und legte den noch leeren Formularzustand ueber den
// gespeicherten Entwurf. Nach jedem Neuladen war das getippte Quellmaterial damit still verloren
// (Review von Paket 044 PR 1; bestand schon vorher, faellt hier nur an derselben Zeile auf).
restoringDraft = true
await Promise.all([loadProfiles(), loadPlatformAvailability()])
const resumePostId = UuidSchema.safeParse(route.query.postId)
const resumeDraftId = UuidSchema.safeParse(route.query.draftId)
if (resumeDraftId.success) await loadServerDraft(resumeDraftId.data)
else if (resumePostId.success) await loadDraftFromPost(resumePostId.data)
else {
  if (route.query.postId !== undefined || route.query.draftId !== undefined) notice.value = 'Der Link zum Entwurf ist ungültig.'
  restoreDraft()
}
restoringDraft = false
onBeforeRouteLeave(async () => { await saveServerDraft() })
onBeforeUnmount(() => { if (hasDraftContent()) void saveServerDraft() })
</script>

<template>
  <div>
    <header class="mb-7"><div class="eyebrow mb-2">Textwerkstatt</div><h1 class="font-display text-3xl font-extrabold">Aus bestätigten Angaben formulieren</h1><p class="mt-2 text-sm text-[#727a75]">Dieser Pilot erstellt nur Text. Ein Foto kann angehängt werden, wird aber nie an das Sprachmodell gesendet. Videoanhänge sind noch nicht verfügbar.</p></header>
    <section v-if="!sessionId" class="card grid gap-5 p-5 sm:p-7">
      <label><span class="mb-1 block text-xs font-semibold">Kommunikationsziel</span><select v-model="communicationGoal" class="w-full rounded-xl border p-3 text-sm sm:max-w-xs"><option value="inform">Informieren</option><option value="invite">Einladen</option><option value="thank">Danken</option><option value="recruit">Gewinnen</option><option value="inspire">Inspirieren</option></select></label>
      <fieldset><legend class="mb-2 text-xs font-semibold">Stilprofil</legend><SearchableSelect v-model="selectedProfile" :groups="profileSelectGroups" placeholder="Stilprofil wählen…" /><NuxtLink to="/stilprofile" class="focus-ring mt-2 inline-block text-[11px] font-semibold text-forest underline">Eigene Stilprofile verwalten →</NuxtLink></fieldset>
      <PhotoAttachment v-if="scope?.organizationId && scope.departmentId" :key="`${scope.organizationId}:${scope.departmentId}`" v-model="mediaAssetId" :organization-id="scope.organizationId" :department-id="scope.departmentId" />
      <fieldset>
        <legend class="mb-2 text-xs font-semibold">Zielplattformen</legend>
        <div v-if="platforms.length" class="flex flex-wrap gap-2">
          <button
            v-for="entry in platforms" :key="entry.platform" type="button"
            class="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            :style="selectedPlatforms.includes(entry.platform) ? { borderColor: platformColors[entry.platform], backgroundColor: `${platformColors[entry.platform]}1a` } : {}"
            :aria-pressed="selectedPlatforms.includes(entry.platform)"
            :disabled="!entry.available"
            :title="entry.reason ? PLATFORM_UNAVAILABLE_REASONS[entry.reason] : undefined"
            @click="togglePlatform(entry.platform)"
          >
            <PlatformIcon :platform="entry.platform" />
            {{ platformLabels[entry.platform] }}
          </button>
        </div>
        <p v-else class="text-[11px] font-normal text-[#9aa096]">Die Zielplattformen konnten nicht geladen werden. Bitte lade die Seite neu.</p>
        <p v-for="reason in unavailableReasons" :key="reason" class="mt-1 text-[11px] font-normal text-[#9aa096]">{{ PLATFORM_UNAVAILABLE_EXPLANATIONS[reason] }}</p>
      </fieldset>
      <fieldset>
        <legend class="mb-2 text-xs font-semibold">Maximale Länge (optional)</legend>
        <input v-model="maxCharactersOverride" type="number" min="100" max="10000" placeholder="z. B. 800" class="w-32 rounded-xl border p-3 text-sm" />
        <p class="mt-1 text-[11px] font-normal text-[#9aa096]">Kürzer als die gewählten Plattformen erlauben ist möglich, länger nicht.</p>
      </fieldset>
      <label><span class="mb-1 block text-xs font-semibold">Bestätigte Fakten (eine Zeile je „Feld: Wert“)</span><textarea v-model="factsText" rows="4" class="w-full rounded-xl border p-3 text-sm" placeholder="Übung: Passen&#10;Gruppe: U12" /></label>
      <label><span class="mb-1 block text-xs font-semibold">Beobachtung oder Rohtext</span><textarea v-model="observation" rows="3" class="w-full rounded-xl border p-3 text-sm" /></label>
      <label><span class="mb-1 block text-xs font-semibold">Nicht erwähnen (je Zeile)</span><input v-model="doNotMention" class="w-full rounded-xl border p-3 text-sm" /></label>
      <div class="flex flex-wrap items-center gap-3"><button class="inline-flex items-center justify-center gap-2 rounded-xl border border-forest px-5 py-3 text-sm font-bold text-forest disabled:opacity-60" :disabled="submitting || draftSaveState === 'saving'" @click="saveServerDraft({ explicit: true })"><LoaderCircle v-if="draftSaveState === 'saving'" class="animate-spin" :size="16" /><Save v-else :size="16" /> Als Entwurf speichern</button><button class="inline-flex items-center justify-center gap-2 rounded-xl bg-forest px-5 py-3 text-sm font-bold text-white disabled:opacity-60" :disabled="submitting" @click="createCandidate"><LoaderCircle v-if="submitting" class="animate-spin" :size="16" /><Sparkles v-else :size="16" /> Textkandidaten erzeugen</button><span v-if="draftSaveState === 'saved'" class="text-xs text-[#727a75]">Entwurf gespeichert</span><span v-else-if="draftSaveState === 'error'" class="text-xs text-amber-800">Lokale Sicherung aktiv</span></div>
    </section>
    <section v-else class="card p-5 sm:p-7"><div class="flex items-center justify-between"><h2 class="font-display text-xl font-bold">{{ candidateFinished ? 'Textkandidat bereit' : 'Text wird erzeugt' }}</h2><button class="rounded-lg border px-3 py-2 text-xs" @click="refreshSession"><RefreshCw :size="14" /> Aktualisieren</button></div><p v-if="candidate && !candidateFinished" class="mt-4 text-sm text-[#727a75]">Der Worker verarbeitet die Anfrage im Hintergrund. Diese Seite enthält keinen Prompt und keine Providerdaten.</p><p v-if="candidate?.triggered_by === 'automatic_recovery'" class="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">Diese Version wurde nach einem technischen Fehler automatisch neu erzeugt.</p><template v-if="candidate?.generated_content"><textarea :value="candidate.generated_content.caption" readonly rows="10" class="mt-5 w-full rounded-xl border p-3 text-sm" /><div class="mt-3 rounded-xl bg-emerald-50 p-3 text-xs text-emerald-900">{{ candidate.generated_content.verifiedFacts.length }} belegte Angaben · {{ candidate.generated_content.missingFacts.length }} offene Angaben</div><label class="mt-5 block"><span class="mb-1 block text-xs font-semibold">Überarbeitungswunsch</span><textarea v-model="revisionInstruction" rows="2" maxlength="500" class="w-full rounded-xl border p-3 text-sm" placeholder="z. B. kürzer und mit direkter Einladung" /></label><button class="mt-3 rounded-xl border px-4 py-2 text-sm font-semibold disabled:opacity-60" :disabled="submitting || !revisionInstruction.trim()" @click="reviseCandidate"><RefreshCw :size="15" class="mr-1 inline" /> Überarbeiten</button><button class="mt-5 inline-flex items-center gap-2 rounded-xl bg-forest px-5 py-3 text-sm font-bold text-white disabled:opacity-60" :disabled="submitting" @click="acceptCandidate"><LoaderCircle v-if="submitting" class="animate-spin" :size="16" /><Check v-else :size="16" /> Übernehmen und zur Freigabe</button></template><p v-if="candidate?.status === 'failed'" class="mt-4 text-sm text-red-700">Die Anfrage konnte nicht verarbeitet werden. Bitte prüfe die bestätigten Angaben und starte eine neue Sitzung.</p></section>
    <p v-if="notice" class="mt-4 text-sm text-amber-800">{{ notice }}</p>
  </div>
</template>
