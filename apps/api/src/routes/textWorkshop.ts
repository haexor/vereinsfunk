import { CommunicationGoalSchema, CompositionSessionStatusSchema, ScheduleOccasionSchema, CreateCompositionSessionSchema, CreateGenerationCommandSchema, GeneratedPostSchema, GenerationCandidateStatusSchema, MaxCharactersSchema, SaveTextWorkshopDraftSchema, SocialPlatformSchema, SourceMaterialSchema, StyleProfileSnapshotSchema, TEXT_GENERATION_DEFAULT_MAX_CHARACTERS, TextGenerationPlatformAvailabilitySchema, TextGenerationTemperatureSchema, TextWorkshopDraftRowSchema, UuidSchema } from '@vereinsfunk/contracts'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { createHash } from 'node:crypto'
import { parseSupabaseData } from '../supabase.js'
import { ensurePassThroughDerivative } from '../passThroughDerivative.js'
import { saveTextWorkshopDraft } from '../services/textWorkshopDrafts.js'
import { loadScheduleOccasion } from '../services/scheduleOccasion.js'
import { createTextGenerationSession, resolveTextGenerationProviderConfigurationIds } from '../services/textGenerationSessions.js'
import type { ApiRouteContext } from './context.js'
import { createAuditRecorder } from './shared.js'
import { resolveTextGenerationPlatformAvailability } from '../services/channelAvailability.js'
import { resolveScopedEffectiveConfig } from '../services/policyRules.js'
import { resolveDirectoryScope, toPermissionScope } from '../services/scopeAuthorization.js'
import { DeletableScopeSchema } from './content.js'

const SessionAttachmentSchema = z.object({ media_asset_id: UuidSchema })

export const TextWorkshopScopeSchema = z.object({ organizationId: UuidSchema, departmentId: UuidSchema.nullable().optional(), teamId: UuidSchema.nullable().optional() })

// Plan 033 text-only workshop. Diese Routen rufen kein LLM auf: sie schreiben Sitzung und einen
// reinen ID-Umschlag ueber eine service-only RPC, die der Worker spaeter ausfuehrt.
export function registerTextWorkshopRoutes(app: FastifyInstance, context: ApiRouteContext): void {
  const { requireAuth, requirePermission, supabaseClients } = context
  const recordAuditEvent = createAuditRecorder(supabaseClients)

  // Plan 042, PR 3 Step 3: welche Plattformen dieser Scope ueberhaupt anhaken darf, und welche
  // Zeichengrenze daraus je Plattform folgt -- eine Route statt zweier, weil das Formular beides
  // zusammen braucht. Dieselbe Berechtigung wie die Sitzungs-Anlage selbst: wer hier lesen darf,
  // haette an dieser Stelle ohnehin einen Beitrag anlegen duerfen.
  app.get('/v1/text-generation-platforms', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const scope = TextWorkshopScopeSchema.parse(request.query)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    // Wie /v1/content-style-profiles/preview: departmentId/teamId gegen ihre echte organization_id verifizieren, BEVOR
    // die Berechtigung geprueft wird -- sonst waeren sie client-seitig frei kombinierbar (Review
    // dieses PRs).
    const resolvedScope = await resolveDirectoryScope(client, scope.organizationId, scope.departmentId ?? null, scope.teamId ?? null)
    if (resolvedScope === null) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, 'post.create', resolvedScope))) return
    const config = await resolveScopedEffectiveConfig(client, scope.organizationId, scope.departmentId ?? null, scope.teamId ?? null)
    const availability = await resolveTextGenerationPlatformAvailability(client, scope.organizationId, scope.departmentId ?? null, scope.teamId ?? null, config.policies.allowedChannelIds)
    // Plan 044, PR 1 Step 3: mit der Verfuegbarkeit geschnitten -- eine Plattform in der Vorgabe
    // ohne (mehr) eingerichteten Kanal ist nicht isDefault, sonst liefe erstellen.vue vorausgewaehlt
    // in ein 422 (dasselbe Schneiden, das restoreDraft dort schon fuer gespeicherte Entwuerfe macht).
    const defaultPlatforms = new Set(config.policies.defaultTargetPlatforms ?? [])
    return reply.code(200).send(
      z.array(TextGenerationPlatformAvailabilitySchema).parse(
        // Fehlt die Vorgabezeile, zeigt die Anzeige den generischen Fallback -- eine Zahl muss hier
        // stehen. Fuer die verbindliche Grenze der Sitzung zaehlt sie dagegen nicht mit (unten).
        [...availability.entries()].map(([platform, entry]) => ({
          ...entry, platform, maxCharacters: entry.maxCharacters ?? TEXT_GENERATION_DEFAULT_MAX_CHARACTERS,
          isDefault: entry.available && defaultPlatforms.has(platform),
        })),
      ),
    )
  })

  app.post('/v1/text-workshop/sessions', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const input = CreateCompositionSessionSchema.parse(request.body)
    const scope = toPermissionScope(input.organizationId, input.departmentId, input.teamId ?? null)
    if (!(await requirePermission(request, reply, 'post.create', scope))) return
    const result = await createTextGenerationSession(
      supabaseClients.forUser(request.auth!.accessToken), () => supabaseClients.forService(), input, request.auth!.userId, request.id,
    )
    if (!result.ok) return reply.code(result.statusCode).send({ error: result.error, ...(result.platform ? { platform: result.platform } : {}), correlationId: request.id })
    return reply.code(202).send({ sessionId: result.sessionId, candidateIds: result.candidateIds, correlationId: request.id })
  })

  // Vorschau des Kalender-Anlasses fuer ?fixtureId=/?clubEventId=: dieselben Fakten, die
  // POST /v1/text-workshop/sessions gleich selbst herleitet.
  app.get('/v1/text-workshop/occasion', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const query = z.object({ organizationId: UuidSchema, departmentId: UuidSchema.optional(), fixtureId: UuidSchema.optional(), clubEventId: UuidSchema.optional() })
      .refine((value) => Boolean(value.fixtureId) !== Boolean(value.clubEventId), { message: 'exactly one of fixtureId or clubEventId is required' })
      .parse(request.query)
    if (!(await requirePermission(request, reply, 'post.create', toPermissionScope(query.organizationId, query.departmentId ?? null)))) return
    const occasion = await loadScheduleOccasion(supabaseClients.forUser(request.auth!.accessToken), { organizationId: query.organizationId, departmentId: query.departmentId ?? null }, query)
    if (!occasion?.ok) return reply.code(404).send({ error: occasion?.error ?? 'not_found', correlationId: request.id })
    return reply.send(ScheduleOccasionSchema.parse(occasion.occasion.view))
  })

  const TEXT_WORKSHOP_DRAFT_COLUMNS = 'id, organization_id, department_id, team_id, post_id, payload, created_at, updated_at'

  // Autosave is deliberately an API write: browser roles cannot write the table directly and the
  // permission/scope check remains the same as for starting a text generation.
  app.put('/v1/text-workshop/drafts/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const id = z.object({ id: UuidSchema }).parse(request.params).id
    const input = SaveTextWorkshopDraftSchema.parse(request.body)
    const requestedScope = toPermissionScope(input.organizationId, input.departmentId, input.teamId ?? null)
    if (!(await requirePermission(request, reply, 'post.create', requestedScope))) return
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const existing = await client.from('text_workshop_drafts').select('id, organization_id, department_id, team_id').eq('id', id).maybeSingle()
    if (existing.error) throw existing.error
    if (existing.data && (existing.data.organization_id !== input.organizationId || existing.data.department_id !== input.departmentId || existing.data.team_id !== (input.teamId ?? null))) {
      return reply.code(404).send({ error: 'draft_not_found', correlationId: request.id })
    }
    const service = supabaseClients.forService()
    // RLS deliberately hides other members' raw drafts. Without this service-side existence
    // check, a guessed UUID would look like a missing row to the user client and upsert could
    // overwrite it under the service role.
    if (!existing.data) {
      const hidden = await service.from('text_workshop_drafts').select('id').eq('id', id).maybeSingle()
      if (hidden.error) throw hidden.error
      if (hidden.data) return reply.code(404).send({ error: 'draft_not_found', correlationId: request.id })
    }
    const saved = await saveTextWorkshopDraft(service, {
      id, organizationId: input.organizationId, departmentId: input.departmentId, teamId: input.teamId ?? null,
      actorUserId: request.auth!.userId, payload: input.payload,
    })
    await recordAuditEvent(request, {
      organizationId: input.organizationId,
      action: 'text_workshop_draft.saved',
      entityType: 'text_workshop_drafts',
      entityId: saved.id,
      metadata: { departmentId: input.departmentId, teamId: input.teamId ?? null },
    })
    return reply.send({ draft: saved, correlationId: request.id })
  })

  app.delete('/v1/text-workshop/drafts/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const id = z.object({ id: UuidSchema }).parse(request.params).id
    const client = supabaseClients.forUser(request.auth!.accessToken)
    // text_workshop_drafts_select_own zeigt ausschliesslich eigene Entwuerfe -- ein fremder Entwurf
    // liefert hier bereits "nicht gefunden", ganz ohne eigenen Eigentuemer-Check.
    const existing = await client.from('text_workshop_drafts').select('id, organization_id, department_id, team_id').eq('id', id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return reply.code(404).send({ error: 'draft_not_found', correlationId: request.id })
    const existingScope = parseSupabaseData(DeletableScopeSchema, existing.data)
    if (!(await requirePermission(request, reply, 'post.create', toPermissionScope(existingScope.organization_id, existingScope.department_id, existingScope.team_id)))) return
    const service = supabaseClients.forService()
    const del = await service.from('text_workshop_drafts').delete().eq('id', id).select('id')
    if (del.error) throw del.error
    // Ein zeitgleicher zweiter Delete-Aufruf derselben Entwurf-ID darf kein Audit-Ereignis fuer eine
    // Loeschung schreiben, die gar nicht stattgefunden hat (Review-Fund PR #161).
    if (del.data.length === 0) return reply.code(404).send({ error: 'draft_not_found', correlationId: request.id })
    await recordAuditEvent(request, {
      organizationId: existingScope.organization_id, action: 'text_workshop_draft.deleted', entityType: 'text_workshop_drafts', entityId: id,
      metadata: { departmentId: existingScope.department_id, teamId: existingScope.team_id },
    })
    return reply.code(204).send()
  })

  app.get('/v1/text-workshop/drafts', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const query = z.object({ organizationId: UuidSchema, departmentId: UuidSchema.nullable().optional(), teamId: UuidSchema.nullable().optional() }).parse(request.query)
    if (!(await requirePermission(request, reply, 'post.create', toPermissionScope(query.organizationId, query.departmentId ?? null, query.teamId ?? null)))) return
    const client = supabaseClients.forUser(request.auth!.accessToken)
    let drafts = client.from('text_workshop_drafts').select(TEXT_WORKSHOP_DRAFT_COLUMNS).eq('organization_id', query.organizationId)
    drafts = (query.departmentId ? drafts.eq('department_id', query.departmentId) : drafts.is('department_id', null)) as typeof drafts
    drafts = (query.teamId ? drafts.eq('team_id', query.teamId) : drafts.is('team_id', null)) as typeof drafts
    const result = await drafts.order('updated_at', { ascending: false })
    if (result.error) throw result.error
    return reply.send({ drafts: z.array(TextWorkshopDraftRowSchema).parse(result.data) })
  })

  app.get('/v1/text-workshop/drafts/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const id = z.object({ id: UuidSchema }).parse(request.params).id
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const result = await client.from('text_workshop_drafts').select(TEXT_WORKSHOP_DRAFT_COLUMNS).eq('id', id).maybeSingle()
    if (result.error) throw result.error
    if (!result.data) return reply.code(404).send({ error: 'draft_not_found', correlationId: request.id })
    const draft = TextWorkshopDraftRowSchema.parse(result.data)
    if (!(await requirePermission(request, reply, 'post.create', toPermissionScope(draft.organization_id, draft.department_id, draft.team_id)))) return
    return reply.send({ draft })
  })

  const TextWorkshopCandidateSchema = z.object({
    id: UuidSchema, status: GenerationCandidateStatusSchema, generated_content: GeneratedPostSchema.nullable(),
    quality_flags: z.array(z.string()), failure_code: z.string().nullable(), triggered_by: z.enum(['member', 'automatic_recovery']),
    accepted_post_version_id: UuidSchema.nullable(), created_at: z.string(),
  })
  const CompositionSessionRowSchema = z.object({
    id: UuidSchema,
    organization_id: UuidSchema,
    department_id: UuidSchema.nullable(),
    team_id: UuidSchema.nullable(),
    status: CompositionSessionStatusSchema,
    communication_goal: CommunicationGoalSchema,
    source_material: SourceMaterialSchema,
    style_profile_id: UuidSchema.nullable(),
    // System- und Persona-Profile tragen ihren eingefrorenen Slug zusaetzlich zum Vertrag.
    style_profile_snapshot: StyleProfileSnapshotSchema.passthrough(),
    target_platforms: z.array(SocialPlatformSchema),
    max_characters: MaxCharactersSchema,
    temperature: TextGenerationTemperatureSchema,
    fixture_id: UuidSchema.nullable(),
    club_event_id: UuidSchema.nullable(),
    created_at: z.iso.datetime({ offset: true }),
  })
  // source_material/style_profile_id/style_profile_snapshot zusaetzlich zu den bisherigen Spalten:
  // beide Routen unten teilen sich diese Liste, damit erstellen.vue eine bestehende Sitzung
  // vollstaendig als Formular-Vorbefuellung lesen kann (Beitraege-Liste -> Textwerkstatt
  // wiedereroeffnen), nicht nur ihre Regler-Werte.
  const COMPOSITION_SESSION_COLUMNS = 'id, organization_id, department_id, team_id, status, communication_goal, source_material, style_profile_id, style_profile_snapshot, target_platforms, max_characters, temperature, fixture_id, club_event_id, created_at'
  async function respondWithCompositionSession(client: SupabaseClient, reply: FastifyReply, sessionRow: z.infer<typeof CompositionSessionRowSchema>) {
    // Paket 046: ein Klick auf Generieren/Ueberarbeiten kann mehrere Kandidaten gleichzeitig
    // anlegen (eine "Runde", gruppiert ueber round_input_hash). Erst die juengste Runde ermitteln,
    // dann alle ihre Kandidaten laden -- vor Paket 046 war das immer genau einer, .limit(1) reichte.
    //
    // round_attempt zusaetzlich zu round_input_hash (Review-Fund, 2026082701): ein Retry nach einem
    // Komplettfehlschlag legt eine frische Runde unter demselben round_input_hash an (unveraenderter
    // Inhalt hasht identisch) -- ohne den Attempt-Filter kaemen die laengst fehlgeschlagenen
    // Geschwister-Kandidaten der alten Runde bei jedem Laden wieder mit zurueck.
    const latestRound = await client.from('generation_candidates').select('round_input_hash, round_attempt').eq('composition_session_id', sessionRow.id).order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (latestRound.error) throw latestRound.error
    if (!latestRound.data) return reply.send({ session: sessionRow, candidates: [] })
    const latestRoundKey = z.object({ round_input_hash: z.string().regex(/^[a-f0-9]{64}$/), round_attempt: z.number().int().positive() }).parse(latestRound.data)
    const candidates = await client.from('generation_candidates').select('id, status, generated_content, quality_flags, failure_code, triggered_by, accepted_post_version_id, created_at').eq('composition_session_id', sessionRow.id).eq('round_input_hash', latestRoundKey.round_input_hash).eq('round_attempt', latestRoundKey.round_attempt).order('created_at', { ascending: true })
    if (candidates.error) throw candidates.error
    return reply.send({ session: sessionRow, candidates: z.array(TextWorkshopCandidateSchema).parse(candidates.data) })
  }
  // Wiedereinstieg aus der Beitraege-Liste: dort ist nur die posts-Zeile bekannt, nicht die
  // composition_session-ID. composition_sessions.post_id wird erst beim ersten
  // accept_text_generation_candidate gesetzt, ist ab dann aber stabil (siehe
  // 2026081103_text_generation_routing.sql) -- fuer den hier relevanten draft_ready/
  // changes_requested-Fall ist er also immer vorhanden.
  app.get('/v1/text-workshop/sessions', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const query = z.object({ postId: UuidSchema }).parse(request.query)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const session = await client.from('composition_sessions').select(COMPOSITION_SESSION_COLUMNS).eq('post_id', query.postId).order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (session.error) throw session.error
    if (!session.data) return reply.code(404).send({ error: 'session_not_found' })
    const sessionRow = CompositionSessionRowSchema.parse(session.data)
    if (!(await requirePermission(request, reply, 'post.create', toPermissionScope(sessionRow.organization_id, sessionRow.department_id, sessionRow.team_id)))) return
    return respondWithCompositionSession(client, reply, sessionRow)
  })
  app.get('/v1/text-workshop/sessions/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const id = z.object({ id: UuidSchema }).parse(request.params).id
    const client = supabaseClients.forUser(request.auth!.accessToken)
    // target_platforms/max_characters/temperature mitlesen: sie sind bei Anlage eingefroren, also
    // kann nur diese Antwort zeigen, mit welcher Regler-Stufe die Sitzung laeuft -- sonst waeren die
    // Werte fuer die UI und den Support nur per direkter DB-Abfrage sichtbar.
    const session = await client.from('composition_sessions').select(COMPOSITION_SESSION_COLUMNS).eq('id', id).maybeSingle()
    if (session.error) throw session.error
    if (!session.data) return reply.code(404).send({ error: 'session_not_found' })
    const sessionRow = CompositionSessionRowSchema.parse(session.data)
    if (!(await requirePermission(request, reply, 'post.create', toPermissionScope(sessionRow.organization_id, sessionRow.department_id, sessionRow.team_id)))) return
    return respondWithCompositionSession(client, reply, sessionRow)
  })

  app.post('/v1/text-workshop/sessions/:id/generations', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const sessionId = z.object({ id: UuidSchema }).parse(request.params).id
    const command = CreateGenerationCommandSchema.parse({ ...z.object({ generationIntent: z.literal('revise'), revisionInstruction: z.string().trim().min(1).max(500) }).parse(request.body), sessionId })
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const session = await client
      .from('composition_sessions')
      .select('id, organization_id, department_id, team_id, communication_goal, requested_formats, source_material, style_profile_id, style_profile_snapshot, effective_config_snapshot, target_platforms, max_characters, temperature, source_revision, input_hash, created_by')
      .eq('id', sessionId)
      .maybeSingle()
    if (session.error) throw session.error
    if (!session.data) return reply.code(404).send({ error: 'session_not_found' })
    if (!(await requirePermission(request, reply, 'post.create', toPermissionScope(session.data.organization_id, session.data.department_id, session.data.team_id)))) return
    const revisionInstruction = command.revisionInstruction!
    const candidateHash = createHash('sha256').update(`${session.data.input_hash}:revise:${revisionInstruction}`).digest('hex')
    const service = supabaseClients.forService()
    const providerConfigurationIds = await resolveTextGenerationProviderConfigurationIds(service)
    if (providerConfigurationIds.length === 0) return reply.code(422).send({ error: 'no_active_text_provider', correlationId: request.id })
    const result = await service.rpc('create_text_generation_session', {
      p_organization_id: session.data.organization_id, p_department_id: session.data.department_id, p_team_id: session.data.team_id,
      p_communication_goal: session.data.communication_goal, p_requested_formats: session.data.requested_formats,
      p_source_material: session.data.source_material, p_style_profile_id: session.data.style_profile_id,
      p_style_profile_snapshot: session.data.style_profile_snapshot, p_effective_config_snapshot: session.data.effective_config_snapshot,
      p_target_platforms: session.data.target_platforms, p_max_characters: session.data.max_characters, p_temperature: session.data.temperature,
      p_source_revision: session.data.source_revision, p_input_hash: session.data.input_hash, p_candidate_input_hash: candidateHash,
      p_generation_intent: 'revise', p_revision_instruction: revisionInstruction, p_created_by: request.auth!.userId,
      p_correlation_id: request.id, p_idempotency_key: `generate-text:${candidateHash}`,
      p_provider_configuration_ids: providerConfigurationIds,
    })
    if (result.error) throw result.error
    return reply.code(202).send({ ...z.object({ sessionId: UuidSchema, candidateIds: z.array(UuidSchema).min(1) }).parse(result.data), correlationId: request.id })
  })

  app.post('/v1/text-workshop/candidates/:id/accept', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const id = z.object({ id: UuidSchema }).parse(request.params).id
    const draftId = z.object({ draftId: UuidSchema.optional() }).parse(request.body ?? {}).draftId
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const candidate = await client.from('generation_candidates').select('organization_id, composition_session_id').eq('id', id).maybeSingle()
    if (candidate.error) throw candidate.error
    if (!candidate.data) return reply.code(404).send({ error: 'candidate_not_found' })
    const session = await client.from('composition_sessions').select('department_id, team_id, post_id').eq('id', candidate.data.composition_session_id).single()
    if (session.error) throw session.error
    if (!(await requirePermission(request, reply, 'post.create', toPermissionScope(candidate.data.organization_id, session.data.department_id, session.data.team_id)))) return
    const service = supabaseClients.forService()
    // Plan 047, PR 0: die Sitzung kann jetzt mehrere Foto-Anhaenge tragen
    // (composition_session_post_media), in der Reihenfolge ihrer position. Die Sharp/Storage-Arbeit
    // dahinter kann keine reine SQL-Funktion leisten, deshalb wird sie hier, vor dem RPC-Aufruf,
    // je Anhang aufgeloest.
    const attachments = await service.from('composition_session_post_media').select('media_asset_id').eq('composition_session_id', candidate.data.composition_session_id).order('position', { ascending: true })
    if (attachments.error) throw attachments.error
    const mediaDerivativeIds: string[] = []
    for (const row of attachments.data) {
      const parsedAttachment = parseSupabaseData(SessionAttachmentSchema, row)
      const derivative = await ensurePassThroughDerivative(service, candidate.data.organization_id, parsedAttachment.media_asset_id)
      if ('error' in derivative) return reply.code(422).send({ error: derivative.error, correlationId: request.id })
      mediaDerivativeIds.push(derivative.id)
    }
    const accepted = await service.rpc('accept_text_generation_candidate', {
      p_candidate_id: id, p_actor_user_id: request.auth!.userId,
      p_media_derivative_ids: mediaDerivativeIds.length > 0 ? mediaDerivativeIds : null,
    })
    if (accepted.error) throw accepted.error
    if (draftId) {
      // An idempotent re-accept only returns the version ID; composition_sessions.post_id is the
      // stable fallback once any candidate of the session has been accepted.
      const postId = z.object({ postId: UuidSchema.optional() }).parse(accepted.data).postId ?? session.data.post_id
      if (postId) {
        let update = service.from('text_workshop_drafts').update({ post_id: postId })
          .eq('id', draftId)
          .eq('organization_id', candidate.data.organization_id)
          .eq('created_by', request.auth!.userId)
        update = session.data.department_id
          ? update.eq('department_id', session.data.department_id)
          : update.is('department_id', null)
        update = session.data.team_id
          ? update.eq('team_id', session.data.team_id)
          : update.is('team_id', null)
        const linked = await update
        if (linked.error) throw linked.error
      }
    }
    return reply.send(accepted.data)
  })
}
