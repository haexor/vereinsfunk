<script setup lang="ts">
import { Check, LoaderCircle, RefreshCw, Save, Sparkles } from '@lucide/vue'
import { MaxCharactersSchema, RequestApprovalResponseSchema, SocialPlatformSchema, SourceMaterialSchema, TEXT_GENERATION_DEFAULT_TEMPERATURE, TextGenerationPlatformAvailabilitySchema, TextWorkshopDraftRowSchema, UuidSchema, type SocialPlatform, type TextGenerationPlatformAvailability } from '@vereinsfunk/contracts'
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
// Plan 047, PR 0: mehrere Fotos moeglich (frueher hoechstens eines, Plan 045 PR 0 Schritt 3) --
// nur reihum von PhotoAttachmentList befuellte Eintraege, die ihre Personen-Pruefung abgeschlossen haben.
const mediaAssetIds = ref<string[]>([])
// Plan 047, PR 1: gesetzt, sobald PhotoLayoutGallery mehrere Fotos zu einem zusammengefuegt hat --
// blendet PhotoAttachmentList/PhotoLayoutGallery gegen eine einfache Ergebnisvorschau aus (siehe
// Template), statt zu versuchen, PhotoAttachmentList von aussen auf das komponierte Foto
// umzubiegen (deren Slots kennen nur den eigenen Upload-Ablauf).
const composedPhotoPreview = ref<{ mediaAssetId: string; signedUrl: string } | null>(null)
// signedUrl ist zeitlich begrenzt gueltig, diese Seite kann waehrend Entwurfsspeicherung und
// Kandidatenerzeugung aber lange offen bleiben -- composedPreviewFailed faengt das kaputte Bild
// ab, ohne mediaAssetIds anzutasten (das komponierte Foto bleibt weiterhin angehaengt).
const composedPreviewFailed = ref(false)
watch(composedPhotoPreview, () => { composedPreviewFailed.value = false })
// Plan 047, PR 2: bei mehreren angehaengten Fotos eine bewusste Wahl statt eines stillschweigenden
// Vorgehens -- 'carousel' entspricht dem seit PR 0 bereits funktionierenden Weg (jedes Foto bleibt
// eine eigene post_media-Zeile), 'layout' blendet PhotoLayoutGallery (PR 1) ein.
const photoMode = ref<'carousel' | 'layout'>('carousel')
// Nur zwei Gruppen in der Dropdown-Liste: System- und eigene Profile sind beides "Stil" (der
// Unterschied ist fuer die Auswahl selbst nicht relevant), Personas bleiben separat.
const PROFILE_GROUPS = [
  { label: 'Stil', kinds: ['system', 'custom'] as const },
  { label: 'Personas', kinds: ['persona'] as const },
] as const
const profileGroups = computed(() => PROFILE_GROUPS.map((group) => ({ label: group.label, items: group.kinds.flatMap((kind) => profiles.value.filter((profile) => profile.kind === kind)) })).filter((group) => group.items.length))
const profileSelectGroups = computed(() => profileGroups.value.map((group) => ({ label: group.label, items: group.items.map((profile) => ({ value: profile.id ?? profile.slug, label: profile.name, description: profile.description })) })))
const communicationGoal = ref('inform')
// Die Erfassung bleibt bewusst ein einziges, freies Feld. Erst an der API-Grenze wird der Text
// in begrenzte Beobachtungen zerlegt; so bleibt die Faktenbindung erhalten, ohne Menschen in ein
// Datenmodell hineinzuzwingen, bevor sie ihren Beitrag überhaupt formuliert haben.
const contentText = ref('')
// Legacy-Entwürfe speichern Ausschlüsse separat. Sie bleiben beim Wechsel zum freien Textfeld
// erhalten und werden erst entfernt, wenn ein Mitglied sie im Formular ausdrücklich löscht.
const doNotMention = ref<string[]>([])
const additionalMediaAssetIds = ref<string[]>([])
const revisionInstruction = ref('')
const serverDraftId = ref<string | null>(null)
const draftSaveState = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')
const draftKey = computed(() => session.value && scope.value?.organizationId ? `vf:text-draft:${session.value.userId}:${scope.value.organizationId}:${scope.value.departmentId ?? 'org'}` : null)
let restoringDraft = false
let draftSaveTimer: ReturnType<typeof setTimeout> | undefined
let serverDraftSaveChain: Promise<void> = Promise.resolve()
let latestServerDraftSave = 0

function sourceMaterial() {
  const text = contentText.value.trim()
  // SourceMaterial begrenzt einzelne Beobachtungen auf 500 Zeichen. Wir teilen nur an
  // Wortgrenzen, damit ein längerer frei formulierter Rohtext vollständig erhalten bleibt.
  const observations: string[] = []
  let rest = text
  while (rest.length > 500 && observations.length < 19) {
    const wordBoundary = Math.max(rest.lastIndexOf(' ', 500), rest.lastIndexOf('\n', 500))
    const boundary = wordBoundary > 0 ? wordBoundary : 500
    observations.push(rest.slice(0, boundary).trim())
    rest = rest.slice(boundary).trim()
  }
  if (rest) observations.push(rest.slice(0, 500))
  return { facts: {}, observations, quotes: [], doNotMention: doNotMention.value }
}
function persistDraft() {
  if (restoringDraft || !import.meta.client || !draftKey.value) return
  localStorage.setItem(draftKey.value, JSON.stringify({ communicationGoal: communicationGoal.value, contentText: contentText.value, doNotMention: doNotMention.value, selectedProfile: selectedProfile.value, temperature: TEXT_GENERATION_DEFAULT_TEMPERATURE, selectedPlatforms: selectedPlatforms.value, maxCharactersOverride: maxCharactersOverride.value }))
}
function clearDraft() { if (import.meta.client && draftKey.value) localStorage.removeItem(draftKey.value) }
function draftPayload() {
  // Die persistierte Vertragsform bleibt vorerst kompatibel zu bestehenden Entwürfen. Das UI
  // schreibt nur noch den Rohtext in observation; die früheren Spezialfelder bleiben leer.
  return { communicationGoal: communicationGoal.value, factsText: '', observation: contentText.value, doNotMention: doNotMention.value.join('\n'), selectedProfile: selectedProfile.value, temperature: TEXT_GENERATION_DEFAULT_TEMPERATURE, selectedPlatforms: selectedPlatforms.value, maxCharactersOverride: maxCharactersOverride.value }
}
function hasDraftContent() {
  const payload = draftPayload()
  return Boolean(payload.observation.trim() || payload.doNotMention.trim() || payload.communicationGoal !== 'inform' || payload.selectedProfile !== 'klar_erklaerend' || payload.selectedPlatforms.length || payload.maxCharactersOverride.trim())
}
async function saveServerDraft({ explicit = false, required = false }: { explicit?: boolean; required?: boolean } = {}): Promise<boolean> {
  if (draftSaveTimer) { clearTimeout(draftSaveTimer); draftSaveTimer = undefined }
  if (restoringDraft || !scope.value?.organizationId || (!explicit && !hasDraftContent())) return false
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
    const draft = z.object({ communicationGoal: z.string(), contentText: z.string().optional(), factsText: z.string().optional(), observation: z.string().optional(), doNotMention: z.union([z.array(z.string()), z.string()]).optional(), selectedProfile: z.string(), selectedPlatforms: z.array(SocialPlatformSchema).default([]), maxCharactersOverride: z.string().default('') }).parse(JSON.parse(raw))
    communicationGoal.value = draft.communicationGoal; contentText.value = draft.contentText ?? [draft.factsText, draft.observation].filter(Boolean).join('\n'); doNotMention.value = Array.isArray(draft.doNotMention) ? draft.doNotMention : draft.doNotMention?.split('\n').map((item) => item.trim()).filter(Boolean) ?? []; selectedProfile.value = draft.selectedProfile; maxCharactersOverride.value = draft.maxCharactersOverride
    // Nur uebernehmen, was laut der zuletzt geladenen Verfuegbarkeit noch anhakbar ist -- ein Kanal
    // kann seit dem letzten Entwurf entfernt worden sein.
    if (draft.selectedPlatforms.length) selectedPlatforms.value = draft.selectedPlatforms.filter((platform) => platforms.value.some((entry) => entry.platform === platform && entry.available))
  } catch { clearDraft() }
}
watch([communicationGoal, contentText, doNotMention, selectedProfile, selectedPlatforms, maxCharactersOverride], () => { persistDraft(); queueServerDraftSave() }, { flush: 'sync', deep: true })
watch(() => `${session.value?.userId ?? ''}:${scope.value?.organizationId ?? ''}:${scope.value?.departmentId ?? ''}`, async () => { restoringDraft = true; sessionId.value = null; candidate.value = null; serverDraftId.value = null; profiles.value = []; communicationGoal.value = 'inform'; selectedProfile.value = 'klar_erklaerend'; contentText.value = ''; doNotMention.value = []; additionalMediaAssetIds.value = []; revisionInstruction.value = ''; platforms.value = []; selectedPlatforms.value = []; maxCharactersOverride.value = ''; mediaAssetIds.value = []; composedPhotoPreview.value = null; photoMode.value = 'carousel'; await Promise.all([loadProfiles(), loadPlatformAvailability()]); restoreDraft(); restoringDraft = false })

async function loadProfiles() {
  if (!scope.value?.organizationId) return
  try {
    const response = await api.request('/v1/content-style-profiles', { query: { organizationId: scope.value.organizationId, departmentId: scope.value.departmentId ?? undefined } }, z.object({ profiles: z.array(z.object({ id: z.string().nullable(), slug: z.string(), kind: z.enum(['system', 'persona', 'custom']), name: z.string(), description: z.string() }).passthrough()) }))
    profiles.value = response.profiles
  } catch { notice.value = 'Stilprofile konnten nicht geladen werden.' }
}

async function loadPlatformAvailability() {
  if (!scope.value?.organizationId) return
  try {
    const response = await api.request('/v1/text-generation-platforms', { query: { organizationId: scope.value.organizationId, departmentId: scope.value.departmentId ?? undefined } }, z.array(TextGenerationPlatformAvailabilitySchema))
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
async function loadExistingSession(id: string) {
  try {
    sessionId.value = id
    await refreshSession()
  } catch {
    sessionId.value = null
    candidate.value = null
    notice.value = 'Die Textgeneration konnte nicht geladen werden.'
  }
}
async function loadServerDraft(draftId: string) {
  try {
    const response = await api.request(`/v1/text-workshop/drafts/${draftId}`, {}, z.object({ draft: TextWorkshopDraftRowSchema }))
    const draft = response.draft
    serverDraftId.value = draft.id
    communicationGoal.value = draft.payload.communicationGoal; contentText.value = [draft.payload.factsText, draft.payload.observation].filter(Boolean).join('\n'); doNotMention.value = draft.payload.doNotMention.split('\n').map((item) => item.trim()).filter(Boolean); selectedProfile.value = draft.payload.selectedProfile; maxCharactersOverride.value = draft.payload.maxCharactersOverride
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
    contentText.value = [
      ...Object.entries(draftSession.source_material.facts).map(([key, value]) => `${key}: ${value}`),
      ...draftSession.source_material.observations,
      ...draftSession.source_material.quotes.map((quote) => quote.text),
    ].join('\n')
    doNotMention.value = draftSession.source_material.doNotMention
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
  if (!scope.value?.organizationId) { notice.value = 'Bitte wähle einen Verein.'; return }
  if (!contentText.value.trim()) { notice.value = 'Schreibe kurz, worum es in deinem Beitrag geht.'; return }
  if (!selectedPlatforms.value.length) { notice.value = 'Bitte wähle mindestens eine Zielplattform.'; return }
  const maxCharacters = parsedMaxCharactersOverride()
  if (maxCharacters === 'invalid') { notice.value = 'Die maximale Länge muss zwischen 100 und 10.000 Zeichen liegen.'; return }
  // Beide Anhang-Komponenten deckeln nur ihren eigenen Zustand auf 10 (siehe deren max-Props unten)
  // -- bei parallelen Uploads in beiden koennen die fertigen Arrays zusammen trotzdem mehr als 10
  // IDs enthalten. Die API weist das mit derselben Grenze zurueck; hier vorher abfangen statt eine
  // verwirrende 422 abzuwarten.
  if (mediaAssetIds.value.length + additionalMediaAssetIds.value.length > 10) { notice.value = 'Insgesamt sind höchstens 10 Medienanhänge erlaubt. Bitte entferne einige.'; return }
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
        mediaAssetIds: [...mediaAssetIds.value, ...additionalMediaAssetIds.value],
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
      // 2026081802 setzt people_reviewed_at in genau diesem Fall automatisch zurueck. Die Antwort
      // nennt nicht, welches der angehaengten Fotos betroffen ist, deshalb werden alle zurueckgesetzt.
      mediaAssetIds.value = []
      composedPhotoPreview.value = null
      photoMode.value = 'carousel'
      notice.value = 'Die Personen-Prüfung eines angehängten Fotos ist nicht mehr aktuell. Bitte die Fotos erneut prüfen.'
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
    if (hasDraftContent() && !(await saveServerDraft({ required: true }))) return
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
// Die globale Primäraktion gehört nur zum Eingabeschritt. Sobald eine Sitzung angelegt ist,
// bestimmt die Kandidatenansicht ihre eigenen Folgeaktionen (überarbeiten/übernehmen).
const showCreateCandidateFab = computed(() => !sessionId.value)
usePageSaveFab({ label: 'Textkandidaten erzeugen', save: createCandidate, saving: submitting, visible: showCreateCandidateFab, icon: Sparkles, savingLabel: 'Textkandidaten werden erzeugt …' })
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
// Nur fuer den Scope gueltig, mit dem die Seite geladen wurde -- ein Foto aus dem mediaAssetId-Link
// gehoert zu genau diesem Bereich. Der Scope-Wechsel-Watcher oben remountet PhotoAttachmentList per
// :key, ohne resumeMediaAssetId (siehe unten) neu auszuwerten; ohne diesen Vergleich wuerde jeder
// Scope-Wechsel erneut versuchen, dasselbe (dann falsch-bereichte) Foto zu laden.
const resumeMediaAssetScopeKey = `${scope.value?.organizationId ?? ''}:${scope.value?.departmentId ?? ''}`
restoringDraft = true
await Promise.all([loadProfiles(), loadPlatformAvailability()])
const resumePostId = UuidSchema.safeParse(route.query.postId)
const resumeDraftId = UuidSchema.safeParse(route.query.draftId)
const resumeSessionId = UuidSchema.safeParse(route.query.sessionId)
const resumeMediaAssetId = UuidSchema.safeParse(route.query.mediaAssetId)
if (resumeDraftId.success) await loadServerDraft(resumeDraftId.data)
else if (resumePostId.success) await loadDraftFromPost(resumePostId.data)
else if (resumeSessionId.success) await loadExistingSession(resumeSessionId.data)
else if (resumeMediaAssetId.success) { /* PhotoAttachmentList fuellt sich selbst ueber initial-media-asset-ids */ }
else {
  if (route.query.postId !== undefined || route.query.draftId !== undefined || route.query.sessionId !== undefined || route.query.mediaAssetId !== undefined) notice.value = 'Der Link zum Entwurf ist ungültig.'
  restoreDraft()
}
restoringDraft = false
onBeforeRouteLeave(async () => { await saveServerDraft() })
onBeforeUnmount(() => { if (hasDraftContent()) void saveServerDraft() })
</script>

<template>
  <div>
    <header class="mb-7"><div class="eyebrow mb-2">Textwerkstatt</div><h1 class="font-display text-3xl font-extrabold">Beitrag erstellen</h1><p class="mt-2 text-sm text-[#727a75]">Schreibe einfach auf, was passiert ist. Bilder, Videos und Musik bleiben private Anhänge und werden nicht an das Sprachmodell gesendet.</p></header>
    <section v-if="!sessionId" class="card grid gap-5 p-5 sm:p-7">
      <label>
        <span class="mb-2 block text-sm font-bold">Was möchtest du erzählen?</span>
        <textarea v-model="contentText" rows="7" maxlength="10000" class="w-full resize-y rounded-2xl border border-[#dfe2da] bg-white p-4 text-sm leading-6 shadow-sm outline-none placeholder:text-[#929991] focus:border-forest focus:ring-2 focus:ring-forest/15" placeholder="Zum Beispiel: Heute hat unsere U12 im Training Passen geübt. Besonders schön war, wie sich alle gegenseitig unterstützt haben." />
      </label>
      <fieldset>
        <legend class="mb-2 text-xs font-semibold">Anhänge</legend>
        <p class="mb-3 text-xs text-[#727a75]">Ein Bild macht deinen Beitrag meist direkt lebendig.</p>
        <template v-if="scope?.organizationId">
          <PhotoAttachmentList v-if="additionalMediaAssetIds.length < 10" :key="`${scope.organizationId}:${scope.departmentId ?? 'org'}`" v-model:media-asset-ids="mediaAssetIds" :organization-id="scope.organizationId" :department-id="scope.departmentId" :max="10 - additionalMediaAssetIds.length" :initial-media-asset-ids="resumeMediaAssetId.success && `${scope.organizationId}:${scope.departmentId ?? ''}` === resumeMediaAssetScopeKey ? [resumeMediaAssetId.data] : undefined" />
          <p v-else class="text-xs text-[#727a75]">Die maximale Anzahl von zehn Anhängen ist erreicht.</p>
          <div class="mt-3 border-t border-[#e7e8e1] pt-3">
            <MediaAttachmentUpload :key="`other-media:${scope.organizationId}:${scope.departmentId ?? 'org'}`" v-model="additionalMediaAssetIds" :organization-id="scope.organizationId" :department-id="scope.departmentId" :max="10 - mediaAssetIds.length" :allow-images="false" review-videos />
          </div>
        </template>
      </fieldset>
      <details class="rounded-xl border border-[#e1e2db] p-4">
        <summary class="cursor-pointer text-sm font-semibold text-[#435047]">Beitrag einstellen</summary>
        <div class="mt-4 grid gap-5">
          <label><span class="mb-1 block text-xs font-semibold">Kommunikationsziel</span><Select v-model="communicationGoal"><SelectTrigger class="sm:max-w-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="inform">Informieren</SelectItem><SelectItem value="invite">Einladen</SelectItem><SelectItem value="thank">Danken</SelectItem><SelectItem value="recruit">Gewinnen</SelectItem><SelectItem value="inspire">Inspirieren</SelectItem></SelectContent></Select></label>
          <label><span class="mb-1 block text-xs font-semibold">Nicht erwähnen</span><textarea :value="doNotMention.join('\n')" rows="2" maxlength="2000" class="w-full rounded-xl border p-3 text-sm" placeholder="Ein Begriff pro Zeile" @input="doNotMention = ($event.target as HTMLTextAreaElement).value.split('\n').map((item) => item.trim()).filter(Boolean)" /></label>
          <fieldset><legend class="mb-2 text-xs font-semibold">Stilprofil</legend><SearchableSelect v-model="selectedProfile" :groups="profileSelectGroups" placeholder="Stilprofil wählen…" /><NuxtLink to="/stilprofile" class="focus-ring mt-2 inline-block text-[11px] font-semibold text-forest underline">Eigene Stilprofile verwalten →</NuxtLink></fieldset>
          <template v-if="scope?.organizationId && scope.departmentId">
        <template v-if="composedPhotoPreview">
          <div class="rounded-xl border border-[#e1e2db] p-3">
            <p class="mb-2 text-xs font-semibold text-[#727a75]">Zusammengefügtes Foto</p>
            <img v-if="!composedPreviewFailed" :src="composedPhotoPreview.signedUrl" alt="Zusammengefügtes Foto" class="max-h-64 w-auto rounded-lg" @error="composedPreviewFailed = true" />
            <p v-else class="text-xs text-[#727a75]">Die Vorschau ist abgelaufen. Das zusammengefügte Foto bleibt angehängt.</p>
            <button type="button" class="mt-2 text-xs text-red-700 underline" @click="composedPhotoPreview = null; mediaAssetIds = []; photoMode = 'carousel'">Andere Fotos wählen</button>
          </div>
        </template>
        <template v-else>
          <div v-if="mediaAssetIds.length >= 2" class="mt-3">
            <p class="mb-1 text-xs font-semibold text-[#5c655f]">Mehrere Fotos verwenden als</p>
            <div class="flex gap-2" role="group" aria-label="Mehrere Fotos verwenden als">
              <button type="button" class="focus-ring rounded-xl border px-3 py-2 text-xs font-semibold" :class="photoMode === 'carousel' ? 'border-forest bg-forest/10 text-forest' : 'border-[#e1e2db]'" :aria-pressed="photoMode === 'carousel'" @click="photoMode = 'carousel'">Karussell</button>
              <button type="button" class="focus-ring rounded-xl border px-3 py-2 text-xs font-semibold" :class="photoMode === 'layout' ? 'border-forest bg-forest/10 text-forest' : 'border-[#e1e2db]'" :aria-pressed="photoMode === 'layout'" @click="photoMode = 'layout'">Bildkomposition</button>
            </div>
            <p class="mt-1 text-[11px] font-normal text-[#9aa096]">{{ photoMode === 'carousel' ? 'Jedes Foto erscheint einzeln, wie mehrere Bilder zum Durchblättern.' : 'Die Fotos werden zu einem einzigen Bild zusammengefügt.' }}</p>
          </div>
          <PhotoLayoutGallery v-if="photoMode === 'layout'" :key="`layout:${scope.organizationId}:${scope.departmentId}`" v-model:media-asset-ids="mediaAssetIds" v-model:composed-preview="composedPhotoPreview" :organization-id="scope.organizationId" :department-id="scope.departmentId" />
        </template>
          </template>
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
        </div>
      </details>
      <div class="flex flex-wrap items-center gap-3"><button class="inline-flex items-center justify-center gap-2 rounded-xl border border-forest px-5 py-3 text-sm font-bold text-forest disabled:opacity-60" :disabled="submitting || draftSaveState === 'saving'" @click="saveServerDraft({ explicit: true })"><LoaderCircle v-if="draftSaveState === 'saving'" class="animate-spin" :size="16" /><Save v-else :size="16" /> Als Entwurf speichern</button><span v-if="draftSaveState === 'saved'" class="text-xs text-[#727a75]">Entwurf gespeichert</span><span v-else-if="draftSaveState === 'error'" class="text-xs text-amber-800">Lokale Sicherung aktiv</span></div>
    </section>
    <section v-else class="card p-5 sm:p-7"><div class="flex items-center justify-between"><h2 class="font-display text-xl font-bold">{{ candidateFinished ? 'Textkandidat bereit' : 'Text wird erzeugt' }}</h2><button class="rounded-lg border px-3 py-2 text-xs" @click="refreshSession"><RefreshCw :size="14" /> Aktualisieren</button></div><p v-if="candidate && !candidateFinished" class="mt-4 text-sm text-[#727a75]">Der Worker verarbeitet die Anfrage im Hintergrund. Diese Seite enthält keinen Prompt und keine Providerdaten.</p><p v-if="candidate?.triggered_by === 'automatic_recovery'" class="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">Diese Version wurde nach einem technischen Fehler automatisch neu erzeugt.</p><template v-if="candidate?.generated_content"><textarea :value="candidate.generated_content.caption" readonly rows="10" class="mt-5 w-full rounded-xl border p-3 text-sm" /><div class="mt-3 rounded-xl bg-emerald-50 p-3 text-xs text-emerald-900">{{ candidate.generated_content.verifiedFacts.length }} belegte Angaben · {{ candidate.generated_content.missingFacts.length }} offene Angaben</div><label class="mt-5 block"><span class="mb-1 block text-xs font-semibold">Überarbeitungswunsch</span><textarea v-model="revisionInstruction" rows="2" maxlength="500" class="w-full rounded-xl border p-3 text-sm" placeholder="z. B. kürzer und mit direkter Einladung" /></label><button class="mt-3 rounded-xl border px-4 py-2 text-sm font-semibold disabled:opacity-60" :disabled="submitting || !revisionInstruction.trim()" @click="reviseCandidate"><RefreshCw :size="15" class="mr-1 inline" /> Überarbeiten</button><button class="mt-5 inline-flex items-center gap-2 rounded-xl bg-forest px-5 py-3 text-sm font-bold text-white disabled:opacity-60" :disabled="submitting" @click="acceptCandidate"><LoaderCircle v-if="submitting" class="animate-spin" :size="16" /><Check v-else :size="16" /> Übernehmen und zur Freigabe</button></template><p v-if="candidate?.status === 'failed'" class="mt-4 text-sm text-red-700">Die Anfrage konnte nicht verarbeitet werden. Bitte prüfe die bestätigten Angaben und starte eine neue Sitzung.</p></section>
    <p v-if="notice" class="mt-4 text-sm text-amber-800">{{ notice }}</p>
  </div>
</template>
