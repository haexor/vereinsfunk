import {
  CommunicationGoalSchema,
  CompositionSessionStatusSchema,
  CreateCompositionSessionSchema,
  CreateCustomStyleProfileRequestSchema,
  CreateGenerationCommandSchema,
  CreateSubmissionSchema,
  CustomStyleProfileSchema,
  GeneratedPostSchema,
  GenerationCandidateStatusSchema,
  MaxCharactersSchema,
  MediaAssetSummarySchema,
  PreviewCustomStyleProfileRequestSchema,
  SocialPlatformSchema,
  SourceMaterialSchema,
  SaveTextWorkshopDraftSchema,
  StyleProfileSnapshotSchema,
  StyleProfileRulesSchema,
  SubmissionAcceptedSchema,
  TeamSchema,
  TEXT_GENERATION_DEFAULT_MAX_CHARACTERS,
  TextGenerationPlatformAvailabilitySchema,
  TextGenerationTemperatureSchema,
  TextWorkshopDraftRowSchema,
  UpdateCustomStyleProfileRequestSchema,
  UuidSchema,
  type Team,
} from '@vereinsfunk/contracts'
import { assertGroundedPost, createGroundedContentBrief, FakeContentGenerator, factsFromClubEvent, factsFromFixture } from '@vereinsfunk/content-engine'
import { createIdempotencyKey, evaluateMediaGate, evaluateSubmitPermission } from '@vereinsfunk/domain'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { CLUB_EVENT_COLUMNS, FIXTURE_COLUMNS, MEDIA_ASSET_SUMMARY_COLUMNS, mapClubEventRow, mapFixtureRow, mapMediaAssetSummaryRow, mapTeamRow } from '../apiMappers.js'
import { ensurePassThroughDerivative } from '../passThroughDerivative.js'
import { saveTextWorkshopDraft } from '../services/textWorkshopDrafts.js'
import { createTextGenerationSession, isStyleProfileUsableInScope, SYSTEM_STYLE_PROFILES } from '../services/textGenerationSessions.js'
import type { ApiRouteContext } from './context.js'
import { buildStyleProfilePromptPreview, checkRateLimit, createAuditRecorder, fetchMemberTrust, isAnyMemberOfOrganization, previewStyleProfile, resolveDirectoryScope, resolvePreviewIdempotencyKey, resolveScopedEffectiveConfig, resolveTextGenerationPlatformAvailability, resolveTextGenerationProviderConfigurationIds, toPermissionScope } from './shared.js'

// Plan 033 text-only workshop. Diese Routen rufen kein LLM auf: sie schreiben Sitzung und einen
// reinen ID-Umschlag ueber eine service-only RPC, die der Worker spaeter ausfuehrt.
const CUSTOM_STYLE_PROFILE_COLUMNS = 'id, organization_id, department_id, team_id, slug, name, description, style_rules, avoid_rules, do_rules, is_active, created_by, created_at, updated_at'
const SessionAttachmentSchema = z.object({ media_asset_id: UuidSchema })
const CompletionAssetScopeSchema = z.object({ organization_id: UuidSchema, department_id: UuidSchema.nullable() })
const DeletableScopeSchema = z.object({ organization_id: UuidSchema, department_id: UuidSchema.nullable(), team_id: UuidSchema.nullable() })

function parseSupabaseData<T>(schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data)
  if (parsed.success) return parsed.data
  const error = new Error('Unexpected Supabase response')
  error.name = 'SupabaseResponseError'
  throw error
}

function mapCustomStyleProfileRow(row: Record<string, unknown>) {
  return {
    id: row.id, organizationId: row.organization_id, departmentId: row.department_id, teamId: row.team_id,
    slug: row.slug, kind: 'custom' as const, name: row.name, description: row.description,
    styleRules: StyleProfileRulesSchema.parse(row.style_rules), avoidRules: row.avoid_rules, doRules: row.do_rules,
    isActive: row.is_active, createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

export function registerContentRoutes(app: FastifyInstance, context: ApiRouteContext): void {
  const { environment, requireAuth, requirePermission, supabaseClients, textGenerator, uploads } = context
  const recordAuditEvent = createAuditRecorder(supabaseClients)

  app.post('/v1/submissions', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const input = CreateSubmissionSchema.parse(request.body)
    if (!(await requirePermission(request, reply, 'post.create', { organizationId: input.organizationId, departmentId: input.departmentId }))) return
    const client = supabaseClients.forUser(request.auth!.accessToken)

    // Paket 011: evaluateSubmitPermission vor der ersten Persistenz -- Berechtigung im Scope ist
    // durch requirePermission oben schon bestaetigt, Vertrauen/Preset/Format sind es noch nicht.
    const config = await resolveScopedEffectiveConfig(client, input.organizationId, input.departmentId, input.teamId ?? null)
    const trust = await fetchMemberTrust(client, request.auth!.userId, input.organizationId, input.departmentId, input.teamId ?? null)
    const submitCheck = evaluateSubmitPermission({
      hasCreatePermission: true,
      // fetchMemberTrust liefert bereits alle zutreffenden Ebenen (Verein, die Abteilung, das
      // Team) -- ein find() auf nur EINE Ebene liesse sich durch die Wahl von teamId umgehen
      // (Abteilungssperre bleibt unbeachtet) oder pruefte die Vereinsebene nie (beim
      // Rechte-Review gefunden). Verschaerfung wirkt wie ueberall sonst: jede Ebene kann
      // sperren, keine kann eine Sperre einer anderen Ebene aufheben.
      submitAllowed: trust.every((record) => record.submitAllowed !== false),
      presetSlug: input.presetSlug,
      requestedFormats: input.requestedFormats,
      allowedPresets: config.policies.allowedPresets,
      allowedFormats: config.policies.allowedFormats,
    })
    if (!submitCheck.allowed) {
      // submit_not_allowed ist eine Berechtigungsfrage (das Vertrauen dieser Person, Plan 011:
      // "Einreichen bei submit_allowed = false -> 403"); preset_not_allowed/format_not_allowed sind
      // inhaltliche Verstoesse gegen die Richtlinie dieses Scopes -> 422 mit maschinenlesbarem Grund.
      const status = submitCheck.reason === 'submit_not_allowed' ? 403 : 422
      return reply.code(status).send({ error: submitCheck.reason, correlationId: request.id })
    }

    // Herkunft eines Spiel-/Veranstaltungsbezugs leitet die API selbst aus der referenzierten
    // Zeile her, nie aus Client-Angaben (plans/README.md, "RPC traut Client nicht") -- der Client
    // nennt nur fixtureId/clubEventId, die tatsaechlichen Fakten/den Quellenstand bestimmt diese
    // Anfrage selbst per factsFromFixture/factsFromClubEvent. sourceMaterial.facts bleibt
    // trotzdem das vom Menschen bestaetigte Ergebnis (plans/019, Abschnitt 3: "er bestaetigt
    // schneller als er tippt, aber er bestaetigt") -- provenance/snapshot sind nur die
    // Herkunftsangabe dazu, keine Ueberschreibung der Fakten.
    let sourceProvenance: Record<string, unknown> = {}
    let sourceRevisionAt: string | null = null
    let sourcePrefillSnapshot: Record<string, unknown> | null = null
    if (input.fixtureId || input.clubEventId) {
      const organizationRow = await client.from('organizations').select('timezone').eq('id', input.organizationId).single()
      if (organizationRow.error) throw organizationRow.error
      const timezone = organizationRow.data.timezone as string

      if (input.fixtureId) {
        const fixtureRow = await client
          .from('fixtures')
          .select(FIXTURE_COLUMNS)
          .eq('organization_id', input.organizationId)
          .eq('id', input.fixtureId)
          .maybeSingle()
        if (fixtureRow.error) throw fixtureRow.error
        if (!fixtureRow.data || fixtureRow.data.department_id !== input.departmentId) {
          return reply.code(400).send({ error: 'fixture_not_found_in_department', correlationId: request.id })
        }
        const fixture = mapFixtureRow(fixtureRow.data)
        let team: Team | null = null
        if (fixture.teamId) {
          const teamRow = await client
            .from('teams')
            .select('id, organization_id, department_id, name, age_group, competition, source_id, archived_at, created_at')
            .eq('id', fixture.teamId)
            .maybeSingle()
          if (teamRow.error) throw teamRow.error
          team = teamRow.data ? TeamSchema.parse(mapTeamRow(teamRow.data)) : null
        }
        const facts = factsFromFixture(fixture, team, timezone)
        if (facts.ok) {
          sourceProvenance = facts.provenance
          sourcePrefillSnapshot = facts.facts
        }
        sourceRevisionAt = fixture.sourceUpdatedAt ?? fixtureRow.data.updated_at as string
      } else if (input.clubEventId) {
        const eventRow = await client
          .from('club_events')
          .select(CLUB_EVENT_COLUMNS)
          .eq('organization_id', input.organizationId)
          .eq('id', input.clubEventId)
          .maybeSingle()
        if (eventRow.error) throw eventRow.error
        if (!eventRow.data || (eventRow.data.department_id !== null && eventRow.data.department_id !== input.departmentId)) {
          return reply.code(400).send({ error: 'event_not_found_in_department', correlationId: request.id })
        }
        const clubEvent = mapClubEventRow(eventRow.data)
        const facts = factsFromClubEvent(clubEvent, timezone)
        if (facts.ok) {
          sourceProvenance = facts.provenance
          sourcePrefillSnapshot = facts.facts
        }
        sourceRevisionAt = clubEvent.sourceUpdatedAt ?? eventRow.data.updated_at as string
      }
    }

    // forbiddenTopics (Plan 011, "Durchsetzung an vier Stellen") wird als eigenes Feld gespeichert
    // und unten direkt an createGroundedContentBrief gereicht -- die Content-Engine kennt es nicht
    // getrennt von anderen Verbotslisten, nur als eine gemeinsame prohibitedClaims-Menge.
    const insert = await client
      .from('submissions')
      .insert({
        organization_id: input.organizationId,
        department_id: input.departmentId,
        team_id: input.teamId ?? null,
        content_type: input.presetSlug,
        preset_slug: input.presetSlug,
        communication_goal: input.communicationGoal,
        requested_formats: input.requestedFormats,
        facts: input.sourceMaterial.facts,
        source_material: {
          ...input.sourceMaterial,
          forbiddenTopics: Array.from(new Set(config.policies.forbiddenTopics)),
        },
        source_revision: input.sourceRevision,
        fixture_id: input.fixtureId ?? null,
        club_event_id: input.clubEventId ?? null,
        source_provenance: sourceProvenance,
        source_revision_at: sourceRevisionAt,
        source_prefill_snapshot: sourcePrefillSnapshot,
        created_by: request.auth!.userId,
      })
      .select('id, status')
      .single()
    if (insert.error) throw insert.error
    const submissionId = insert.data.id as string
    const correlationId = request.id
    const generated = await new FakeContentGenerator().generate(input, config.policies.forbiddenTopics)
    let draft: { postId: string; postVersionId: string } | null = null
    if (generated.missingFacts.length === 0) {
      // Schliesst die seit den Paketen 011/012/014/015/019 dokumentierte Luecke: bis hierhin
      // entstand nie ein post/post_version aus einer submission (plans/025). assertGroundedPost
      // setzt die in Plan 001 nur definierte, nie durchgesetzte Invariante erstmals durch --
      // mit FakeContentGenerator deterministisch nie verletzt, aber kein stilles Sicherheitsnetz.
      assertGroundedPost(generated, createGroundedContentBrief(input, config.policies.forbiddenTopics))

      // Geflacht, NICHT die unveraenderte EffectiveConfig-Verschachtelung: schedule_publication
      // und GET /v1/post-versions/:id/available-channels lesen bereits heute
      // effective_config_snapshot->'config'->'allowedChannelIds' direkt, nicht
      // ->'config'->'policies'->'allowedChannelIds'. Da bisher nichts diese Spalte beschrieb, blieb
      // der Mismatch folgenlos -- als erster Schreibzugriff muss dieser Code die gelesene Form
      // treffen, sonst waere die Kanal-Beschraenkung aus 011/012 ab hier stillschweigend wirkungslos.
      const effectiveConfigSnapshot = { config: { goals: config.goals, hashtags: config.hashtags, ...config.policies } }

      // posts/post_versions/post_variants haben keine Insert-Policy fuer authenticated (RLS ohne
      // passende Policy verweigert das grundsaetzlich) -- Schreibzugriff laeuft wie bei
      // directory_people/fixtures/consent_records ausschliesslich ueber die API mit Service Role,
      // nach dem bereits oben erfolgten requirePermission('post.create', ...).
      const service = supabaseClients.forService()
      const postInsert = await service
        .from('posts')
        .insert({
          organization_id: input.organizationId, department_id: input.departmentId, team_id: input.teamId ?? null,
          submission_id: submissionId, status: 'draft_ready', created_by: request.auth!.userId,
        })
        .select('id')
        .single()
      if (postInsert.error) throw postInsert.error
      const postId = postInsert.data.id as string

      // Die vier Schreibvorgaenge sind getrennte PostgREST-Aufrufe ohne gemeinsame Transaktion --
      // ohne diese Kompensation bliebe bei jedem Fehler nach dem posts-Insert eine 'draft_ready'-
      // Zeile ohne current_version_id und ohne Version zurueck (Code-Review zu PR #25, dieselbe
      // Kompensationslehre wie bei POST /v1/llm-providers und POST /v1/oauth-pending/:id/select).
      try {
        const versionInsert = await service
          .from('post_versions')
          .insert({
            organization_id: input.organizationId, post_id: postId, version_number: 1,
            source_facts_snapshot: input.sourceMaterial, effective_config_snapshot: effectiveConfigSnapshot,
            title: generated.headline, caption: generated.caption, call_to_action: generated.callToAction,
            hashtags: generated.hashtags, alt_text: generated.altText, safety_flags: generated.safetyFlags,
            created_by_type: 'llm',
          })
          .select('id')
          .single()
        if (versionInsert.error) throw versionInsert.error
        const postVersionId = versionInsert.data.id as string

        const postUpdate = await service.from('posts').update({ current_version_id: postVersionId }).eq('id', postId)
        if (postUpdate.error) throw postUpdate.error

        // Welche Variante/welches Format zu einer konkreten Veroeffentlichung gehoert, ist Teil des
        // noch fehlenden Kreativsystems (Plan 005) -- hier nur befuellt, weil das Datenmodell es
        // erwartet und generated.variants es bereits vollstaendig liefert.
        if (generated.variants.length > 0) {
          const variantsInsert = await service.from('post_variants').insert(
            generated.variants.map((variant) => ({
              organization_id: input.organizationId, post_version_id: postVersionId, platform: variant.platform,
              format: variant.format, schema_version: '1', prompt_version: generated.templateId, variant,
            })),
          )
          if (variantsInsert.error) throw variantsInsert.error
        }

        await recordAuditEvent(request, {
          organizationId: input.organizationId, action: 'post.drafted', entityType: 'post_versions', entityId: postVersionId,
          metadata: { postId, submissionId, presetSlug: input.presetSlug },
        })
        draft = { postId, postVersionId }
      } catch (err) {
        await service.from('posts').delete().eq('id', postId)
        throw err
      }
    }
    const accepted = SubmissionAcceptedSchema.parse({
      submissionId,
      correlationId,
      status: generated.missingFacts.length > 0 ? 'facts_required' : 'queued',
      idempotencyKey: createIdempotencyKey('submission', submissionId, input.sourceRevision),
      ...(draft ?? {}),
    })

    request.log.info(
      {
        organizationId: input.organizationId,
        departmentId: input.departmentId,
        submissionId,
        correlationId,
        missingFactsCount: generated.missingFacts.length,
        postVersionId: draft?.postVersionId ?? null,
      },
      'submission accepted',
    )

    return reply.code(202).send({ ...accepted, preview: generated })
  })

  // /beitraege zeigte Entwuerfe bisher nur an -- es gab keinen Weg, einen verworfenen wieder
  // loszuwerden. Loeschbar bleibt nur, was noch keine Freigabeanfrage durchlaufen hat; die
  // eigentliche Statuspruefung sitzt atomar (SELECT ... FOR UPDATE) in delete_post_if_deletable
  // (Migration 2026082408), damit ein zeitgleiches Einreichen zur Freigabe nicht verloren geht.
  app.delete('/v1/posts/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const existing = await client.from('posts').select('organization_id, department_id, team_id').eq('id', params.id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return reply.code(404).send({ error: 'post_not_found', correlationId: request.id })
    const existingScope = parseSupabaseData(DeletableScopeSchema, existing.data)
    if (!(await requirePermission(request, reply, 'post.edit', toPermissionScope(existingScope.organization_id, existingScope.department_id, existingScope.team_id)))) return
    const service = supabaseClients.forService()
    const deletion = await service.rpc('delete_post_if_deletable', { target_post_id: params.id })
    if (deletion.error) {
      if (deletion.error.message.includes('post_not_deletable')) return reply.code(409).send({ error: 'post_not_deletable', correlationId: request.id })
      throw deletion.error
    }
    if (!deletion.data) return reply.code(404).send({ error: 'post_not_found', correlationId: request.id })
    await recordAuditEvent(request, {
      organizationId: existingScope.organization_id, action: 'post.deleted', entityType: 'posts', entityId: params.id,
    })
    return reply.code(204).send()
  })

  const TextWorkshopScopeSchema = z.object({ organizationId: UuidSchema, departmentId: UuidSchema.nullable().optional(), teamId: UuidSchema.nullable().optional() })

  app.get('/v1/content-style-profiles', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const scope = TextWorkshopScopeSchema.parse(request.query)
    if (!(await requirePermission(request, reply, 'post.create', toPermissionScope(scope.organizationId, scope.departmentId ?? null, scope.teamId ?? null)))) return
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const rows = await client.from('content_style_profiles').select('id, slug, name, description, style_rules, avoid_rules, do_rules, department_id, team_id, created_by, created_at, updated_at, is_active').eq('organization_id', scope.organizationId).eq('is_active', true)
    if (rows.error) throw rows.error
    // Plan 037: platform-admin-curated personas are the third, global source alongside the
    // hardcoded system modes and each organization's own custom profiles -- no organization_id
    // filter, since platform_style_personas has none.
    const personaRows = await client.from('platform_style_personas').select('id, slug, name, description, style_rules, avoid_rules, do_rules').eq('is_active', true)
    if (personaRows.error) throw personaRows.error
    const systems = Object.entries(SYSTEM_STYLE_PROFILES).map(([slug, profile]) => ({ id: null, slug, kind: 'system', ...profile, isActive: true }))
    const personas = personaRows.data.map((row) => ({ id: row.id, slug: row.slug, kind: 'persona', name: row.name, description: row.description, styleRules: StyleProfileRulesSchema.parse(row.style_rules), avoidRules: row.avoid_rules, doRules: row.do_rules, isActive: true }))
    // Nur die Profile, mit denen sich im angefragten Scope auch eine Sitzung anlegen laesst --
    // dieselbe Regel wie in createTextGenerationSession, sonst bietet erstellen.vue ein Profil an,
    // das die Anlage anschliessend mit style_profile_not_found ablehnt. System- und
    // Plattform-Personas sind global und daher nicht betroffen.
    const customs = rows.data
      .filter((row) => isStyleProfileUsableInScope(row, scope.departmentId ?? null, scope.teamId ?? null))
      .map((row) => ({ id: row.id, slug: row.slug, kind: 'custom', name: row.name, description: row.description, styleRules: StyleProfileRulesSchema.parse(row.style_rules), avoidRules: row.avoid_rules, doRules: row.do_rules, isActive: row.is_active }))
    return reply.send({ profiles: [...systems, ...personas, ...customs] })
  })

  // Plan 042, PR 3 Step 3: welche Plattformen dieser Scope ueberhaupt anhaken darf, und welche
  // Zeichengrenze daraus je Plattform folgt -- eine Route statt zweier, weil das Formular beides
  // zusammen braucht. Dieselbe Berechtigung wie die Sitzungs-Anlage selbst: wer hier lesen darf,
  // haette an dieser Stelle ohnehin einen Beitrag anlegen duerfen.
  app.get('/v1/text-generation-platforms', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const scope = TextWorkshopScopeSchema.parse(request.query)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    // Wie /preview oben: departmentId/teamId gegen ihre echte organization_id verifizieren, BEVOR
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

  app.post('/v1/content-style-profiles', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const input = CreateCustomStyleProfileRequestSchema.parse(request.body)
    if (!(await requirePermission(request, reply, 'post.create', toPermissionScope(input.organizationId, input.departmentId ?? null, input.teamId ?? null)))) return
    const service = supabaseClients.forService()
    const inserted = await service.from('content_style_profiles').insert({ organization_id: input.organizationId, department_id: input.departmentId ?? null, team_id: input.teamId ?? null, slug: input.slug, name: input.name, kind: 'custom', description: input.description, style_rules: input.styleRules, avoid_rules: input.avoidRules, do_rules: input.doRules, created_by: request.auth!.userId }).select('id').single()
    if (inserted.error) throw inserted.error
    await recordAuditEvent(request, { organizationId: input.organizationId, action: 'content_style_profile.created', entityType: 'content_style_profile', entityId: inserted.data.id as string, metadata: { scope: input.teamId ? 'team' : input.departmentId ? 'department' : 'organization' } })
    return reply.code(201).send({ id: inserted.data.id })
  })

  // Scope is derived from the existing row, never from the client (plans/README.md, "RPC traut
  // Client nicht") -- organizationId/departmentId/teamId are immutable and not part of the
  // request body, unlike POST above which still has to establish them.
  app.patch('/v1/content-style-profiles/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const service = supabaseClients.forService()
    const existing = await service.from('content_style_profiles').select('organization_id, department_id, team_id').eq('id', params.id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return reply.code(404).send({ error: 'content_style_profile_not_found' })
    if (!(await requirePermission(request, reply, 'post.create', toPermissionScope(existing.data.organization_id, existing.data.department_id, existing.data.team_id)))) return
    const input = UpdateCustomStyleProfileRequestSchema.parse(request.body)
    const payload: Record<string, unknown> = {}
    if (input.slug !== undefined) payload.slug = input.slug
    if (input.name !== undefined) payload.name = input.name
    if (input.description !== undefined) payload.description = input.description
    if (input.styleRules !== undefined) payload.style_rules = input.styleRules
    if (input.avoidRules !== undefined) payload.avoid_rules = input.avoidRules
    if (input.doRules !== undefined) payload.do_rules = input.doRules
    if (input.isActive !== undefined) payload.is_active = input.isActive
    const update = await service.from('content_style_profiles').update(payload).eq('id', params.id).select(CUSTOM_STYLE_PROFILE_COLUMNS).maybeSingle()
    if (update.error) throw update.error
    if (!update.data) return reply.code(404).send({ error: 'content_style_profile_not_found' })
    await recordAuditEvent(request, { organizationId: existing.data.organization_id, action: 'content_style_profile.updated', entityType: 'content_style_profile', entityId: params.id, metadata: { fields: Object.keys(input) } })
    return reply.code(200).send(CustomStyleProfileSchema.parse(mapCustomStyleProfileRow(update.data)))
  })

  app.delete('/v1/content-style-profiles/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const service = supabaseClients.forService()
    const existing = await service.from('content_style_profiles').select('organization_id, department_id, team_id').eq('id', params.id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return reply.code(404).send({ error: 'content_style_profile_not_found' })
    if (!(await requirePermission(request, reply, 'post.create', toPermissionScope(existing.data.organization_id, existing.data.department_id, existing.data.team_id)))) return
    const del = await service.from('content_style_profiles').delete().eq('id', params.id)
    if (del.error) throw del.error
    await recordAuditEvent(request, { organizationId: existing.data.organization_id, action: 'content_style_profile.deleted', entityType: 'content_style_profile', entityId: params.id, metadata: { scope: existing.data.team_id ? 'team' : existing.data.department_id ? 'department' : 'organization' } })
    return reply.code(204).send()
  })

  // "Stilprofil testen": calls the active text provider directly and synchronously, no
  // session/candidate row (see previewStyleProfile, routes/shared.ts). Scope-gated like POST
  // above -- a member may only preview a profile in a scope they could actually create one in.
  app.post('/v1/content-style-profiles/preview', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    // Anders als jede andere Route dieses Moduls loest ein Aufruf sofort einen kostenpflichtigen
    // Provider-Abruf aus -- ohne Limit ist der "Testen"-Knopf ein Kostenhebel, den eine Schleife im
    // Browser eines einzigen Mitglieds beliebig oft ziehen kann. Pro Nutzer statt pro IP wie die
    // oeffentlichen Routen, weil hinter einer Vereins-IP viele legitime Mitglieder sitzen.
    if (!checkRateLimit(`style-preview:${request.auth!.userId}`, 10, 60_000)) {
      return reply.code(429).send({ error: 'rate_limited', correlationId: request.id })
    }
    const input = PreviewCustomStyleProfileRequestSchema.parse(request.body)
    // departmentId/teamId gegen ihre echte organization_id verifizieren, BEVOR die Berechtigung
    // geprueft wird (resolveDirectoryScope, shared.ts): rolesForScope vereinigt Organisations-,
    // Abteilungs- und Teamrollen, eine frei kombinierte fremde departmentId kann die Rollenmenge
    // also nur vergroessern. Bei POST oben faengt der zusammengesetzte Fremdschluessel der Tabelle
    // die Kombination ab -- diese Route schreibt nichts und hat diesen Rueckhalt nicht.
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const scope = await resolveDirectoryScope(client, input.organizationId, input.departmentId ?? null, input.teamId ?? null)
    if (scope === null) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, 'post.create', scope))) return
    // A retried request (client-side timeout, double-click) must not bill the provider twice --
    // resolvePreviewIdempotencyKey/previewStyleProfile share one in-flight call per key (shared.ts).
    const idempotencyKey = resolvePreviewIdempotencyKey(request)
    if (idempotencyKey === null) return reply.code(400).send({ error: 'invalid_idempotency_key', correlationId: request.id })
    const result = await previewStyleProfile(supabaseClients, environment, input, idempotencyKey, textGenerator)
    if (!result.ok) return reply.code(result.status).send({ error: result.error, correlationId: request.id })
    return reply.code(200).send(result.post)
  })

  // "System-Prompt anzeigen": no provider call, no cost -- see buildStyleProfilePromptPreview
  // (routes/shared.ts). Same scope gate as /preview above (same draft data, same "may only look at
  // a scope one could actually create a profile in" rule), but no rate limit/idempotency key
  // needed since nothing billable happens.
  app.post('/v1/content-style-profiles/prompt-preview', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const input = PreviewCustomStyleProfileRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const scope = await resolveDirectoryScope(client, input.organizationId, input.departmentId ?? null, input.teamId ?? null)
    if (scope === null) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, 'post.create', scope))) return
    return reply.code(200).send(buildStyleProfilePromptPreview(input))
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
    created_at: z.iso.datetime({ offset: true }),
  })
  // source_material/style_profile_id/style_profile_snapshot zusaetzlich zu den bisherigen Spalten:
  // beide Routen unten teilen sich diese Liste, damit erstellen.vue eine bestehende Sitzung
  // vollstaendig als Formular-Vorbefuellung lesen kann (Beitraege-Liste -> Textwerkstatt
  // wiedereroeffnen), nicht nur ihre Regler-Werte.
  const COMPOSITION_SESSION_COLUMNS = 'id, organization_id, department_id, team_id, status, communication_goal, source_material, style_profile_id, style_profile_snapshot, target_platforms, max_characters, temperature, created_at'
  async function respondWithCompositionSession(client: SupabaseClient, reply: FastifyReply, sessionRow: z.infer<typeof CompositionSessionRowSchema>) {
    // Paket 046: ein Klick auf Generieren/Ueberarbeiten kann mehrere Kandidaten gleichzeitig
    // anlegen (eine "Runde", gruppiert ueber round_input_hash). Erst die juengste Runde ermitteln,
    // dann alle ihre Kandidaten laden -- vor Paket 046 war das immer genau einer, .limit(1) reichte.
    const latestRound = await client.from('generation_candidates').select('round_input_hash').eq('composition_session_id', sessionRow.id).order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (latestRound.error) throw latestRound.error
    if (!latestRound.data) return reply.send({ session: sessionRow, candidates: [] })
    const roundInputHash = z.object({ round_input_hash: z.string().regex(/^[a-f0-9]{64}$/) }).parse(latestRound.data).round_input_hash
    const candidates = await client.from('generation_candidates').select('id, status, generated_content, quality_flags, failure_code, triggered_by, accepted_post_version_id, created_at').eq('composition_session_id', sessionRow.id).eq('round_input_hash', roundInputHash).order('created_at', { ascending: true })
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

  const UploadInitiateSchema = z.object({ organizationId: UuidSchema, departmentId: UuidSchema.nullable(), filename: z.string().min(1).max(120).regex(/^[^/\\]+$/), mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'audio/mpeg', 'audio/mp4']), byteSize: z.int().positive().max(100 * 1024 * 1024) })
  app.post('/v1/media/uploads', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const input = UploadInitiateSchema.parse(request.body); const assetId = randomUUID()
    if (!(await requirePermission(request, reply, 'post.create', toPermissionScope(input.organizationId, input.departmentId)))) return
    const service = supabaseClients.forService()
    // Plan 021: geprueft wird VOR dem Ausstellen der signierten URL, nicht erst nach dem Hochladen
    // -- sonst laege das Objekt schon im Bucket, wenn die Grenze auffiel. reserve_storage_upload()
    // prueft und reserviert atomar unter einer Vereinssperre (dieselbe Begruendung wie
    // enforce_structure_limit()/schedule_publication(): zwei parallele Uploads knapp unter der
    // Grenze duerfen sie nicht gemeinsam ueberschreiten -- eine getrennte TS-seitige Pruefung vor
    // einem ungesperrten insert liesse genau das zu, gefunden im eigenen Review dieser PR).
    // object_path folgt demselben Muster wie LocalUploadService.create() unten, weil die echte
    // Pfadvergabe dort passiert und hier noch nicht bekannt ist.
    const objectPath = input.departmentId
      ? `organizations/${input.organizationId}/departments/${input.departmentId}/assets/${assetId}/${input.filename}`
      : `organizations/${input.organizationId}/assets/${assetId}/${input.filename}`
    const reservation = await service.rpc('reserve_storage_upload', {
      target_organization: input.organizationId, target_department: input.departmentId, target_asset_id: assetId,
      target_bucket_id: 'raw-media', target_object_path: objectPath,
      target_mime_type: input.mimeType, announced_bytes: input.byteSize, target_created_by: request.auth!.userId,
    })
    if (reservation.error) {
      const match = reservation.error.message.match(/storage_limit_reached: (organization|department)\/(\d+)\/(\d+)/)
      if (match) return reply.code(409).send({ error: 'storage_limit_reached', scope: match[1], limitBytes: Number(match[2]), usedBytes: Number(match[3]), correlationId: request.id })
      throw reservation.error
    }
    const upload = await uploads.create({ ...input, assetId })
    return reply.code(201).send({ assetId, ...upload })
  })
  app.post('/v1/media/:assetId/complete', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ assetId: UuidSchema }).parse(request.params); const body = z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/i) }).parse(request.body)
    // Zugehoerigkeit ausschliesslich per Service Client nachschlagen, nie per Nutzer-Client:
    // media_assets_select gewaehrt nur is_department_member, waehrend das Abschliessen 'post.edit'
    // verlangt -- reserve_storage_upload() legt die Zeile synchron an (Paket 021), assetId ist ab
    // dann immer bekannt.
    const service = supabaseClients.forService()
    const asset = await service.from('media_assets').select('organization_id, department_id').eq('id', params.assetId).maybeSingle()
    if (asset.error) throw asset.error
    if (!asset.data) return reply.code(404).send({ error: 'media_asset_not_found', correlationId: request.id })
    const parsedAsset = parseSupabaseData(CompletionAssetScopeSchema, asset.data)
    if (!(await requirePermission(request, reply, 'post.edit', toPermissionScope(parsedAsset.organization_id, parsedAsset.department_id)))) return
    return reply.code(202).send(await uploads.complete({ ...params, ...body }))
  })
  // Signed URLs koennen nicht ueber den Nutzer-Client erzeugt werden (kein Storage-Grant fuer
  // authenticated auf rendered-media/raw-media) -- derselbe Service-Client wie in photoLayout.ts:222.
  // Nur fuer Bilder: es gibt keine Video-/Audio-Vorschau-Pipeline. Ein einzelner fehlgeschlagener
  // Storage-Aufruf (z. B. ein geloeschtes/inkonsistentes Objekt) faellt auf signedUrl: null zurueck
  // statt die ganze Liste per throw abzureissen -- die Aufrufer zeigen fehlendes signedUrl bereits
  // als Icon-Platzhalter bzw. lehnen die Wiederverwendung sauber ab (PhotoAttachment.vue).
  async function signMediaAssetSummary(service: SupabaseClient, row: Record<string, unknown>) {
    const mimeType = row.mime_type as string
    if (!mimeType.startsWith('image/')) return mapMediaAssetSummaryRow(row, null)
    const signed = await service.storage.from(row.bucket_id as string).createSignedUrl(row.object_path as string, 600)
    return mapMediaAssetSummaryRow(row, signed.error ? null : signed.data.signedUrl)
  }
  // Fuer eine ganze Liste: ein createSignedUrl-Aufruf je Bild-Zeile waere bei der Galerie (bis zu 60
  // Zeilen) bis zu 60 einzelne Storage-Roundtrips. Bild-Zeilen nach bucket_id gruppieren (raw-media
  // vs. rendered-media) und je Bucket createSignedUrls (Plural, ein Aufruf fuer alle Pfade) nutzen.
  async function signMediaAssetSummaries(service: SupabaseClient, rows: Record<string, unknown>[]) {
    const rowsByBucket = new Map<string, Record<string, unknown>[]>()
    for (const row of rows) {
      if (!(row.mime_type as string).startsWith('image/')) continue
      const bucketId = row.bucket_id as string
      const bucketRows = rowsByBucket.get(bucketId) ?? []
      bucketRows.push(row)
      rowsByBucket.set(bucketId, bucketRows)
    }
    const signedUrlByKey = new Map<string, string>()
    await Promise.all([...rowsByBucket.entries()].map(async ([bucketId, bucketRows]) => {
      const signed = await service.storage.from(bucketId).createSignedUrls(bucketRows.map((row) => row.object_path as string), 600)
      if (signed.error) return
      for (const entry of signed.data) {
        if (entry.path && entry.signedUrl) signedUrlByKey.set(`${bucketId}:${entry.path}`, entry.signedUrl)
      }
    }))
    return rows.map((row) => mapMediaAssetSummaryRow(row, signedUrlByKey.get(`${row.bucket_id as string}:${row.object_path as string}`) ?? null))
  }
  // Medien-/Postuebersicht: Galerie bereits erzeugter Fotos/Videos, plus Auswahlquelle fuer die
  // Wiederverwendung in einem neuen Beitrag und fuer den Chat-Anhang-Picker. Reiner authentifizierter
  // Read, RLS (media_assets_select) traegt die Sichtbarkeit -- gleiches Muster wie
  // GET /v1/organizations/:id/directory-people.
  const MediaAssetListQuerySchema = z.object({
    organizationId: UuidSchema,
    departmentId: UuidSchema.optional(),
    mimeTypePrefix: z.enum(['image/', 'video/', 'audio/']).optional(),
    createdBy: z.literal('me').optional(),
    // reviewedOnly=true grenzt auf Assets ein, deren Personen-/Einwilligungspruefung bereits
    // bestaetigt ist (people_reviewed_at gesetzt) -- Voraussetzung fuer die Wiederverwendung in
    // einem neuen Beitrag, siehe PhotoAttachment.vue. z.stringbool() statt z.coerce.boolean():
    // letzteres macht jeden nicht-leeren String wahr (siehe directory.ts isMinor-Kommentar).
    reviewedOnly: z.stringbool().optional(),
  })
  app.get('/v1/media-assets', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const query = MediaAssetListQuerySchema.parse(request.query)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const validatedScope = await resolveDirectoryScope(client, query.organizationId, query.departmentId ?? null, null)
    if (!validatedScope || !(await isAnyMemberOfOrganization(client, request.auth!.userId, query.organizationId))) {
      return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    }
    let builder = client
      .from('media_assets')
      .select(MEDIA_ASSET_SUMMARY_COLUMNS)
      .eq('organization_id', query.organizationId)
      .eq('upload_status', 'ready')
    if (query.departmentId !== undefined) builder = builder.eq('department_id', query.departmentId)
    if (query.mimeTypePrefix) builder = builder.like('mime_type', `${query.mimeTypePrefix}%`)
    if (query.createdBy === 'me') builder = builder.eq('created_by', request.auth!.userId)
    // reviewedOnly gilt nur fuer Bild/Video: nur diese beiden durchlaufen ueberhaupt eine
    // Personen-Pruefung (people_reviewed_at), siehe textGenerationSessions.ts:100. "people_reviewed_at
    // is not null" allein wuerde Audio-Assets, deren Spalte nie gesetzt wird, faelschlich dauerhaft
    // ausschliessen -- deshalb die Bild/Video-Ausnahme mit in den SQL-Filter. Muss VOR limit(60)
    // angewendet werden: ein Filter nach dem Abruf wuerde die bereits gedeckelte Seite weiter
    // ausduennen, statt die 60 relevantesten Treffer zu liefern.
    if (query.reviewedOnly) builder = builder.or('and(mime_type.not.like.image/*,mime_type.not.like.video/*),people_reviewed_at.not.is.null')
    const result = await builder.order('created_at', { ascending: false }).limit(60)
    if (result.error) throw result.error
    const rows = (result.data ?? []) as Record<string, unknown>[]
    const summaries = await signMediaAssetSummaries(supabaseClients.forService(), rows)
    return reply.code(200).send(z.array(MediaAssetSummarySchema).parse(summaries))
  })

  // Einzelabruf fuer die Wiederverwendung eines bestehenden Fotos in PhotoAttachment.vue: dort ist
  // nur die Asset-ID bekannt (aus dem mediaAssetId-Query-Parameter von erstellen.vue), nicht der
  // volle Scope. RLS entscheidet Sichtbarkeit -- ein unbekanntes oder unsichtbares Asset ergibt
  // denselben not_found wie ein tatsaechlich fehlendes, kein Unterschied nach aussen.
  app.get('/v1/media-assets/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const found = await client.from('media_assets').select(MEDIA_ASSET_SUMMARY_COLUMNS).eq('id', params.id).eq('upload_status', 'ready').maybeSingle()
    if (found.error) throw found.error
    if (!found.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    return reply.code(200).send(await signMediaAssetSummary(supabaseClients.forService(), found.data as Record<string, unknown>))
  })

  app.post('/v1/media/gate', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    // Keine requirePermission-Pruefung: reine, zustandslose Regelauswertung ohne Scope-Bezug
    // und ohne Datenzugriff -- es gibt nichts scope-Gebundenes, gegen das zu pruefen waere.
    const input = z.object({
      scanStatus: z.enum(['pending', 'clean', 'failed']), peopleReviewPending: z.boolean(), hasOriginalSelected: z.boolean(),
      derivativeCurrent: z.boolean(), minorReviewConfirmed: z.boolean(),
      faces: z.array(z.object({
        subjectKind: z.enum(['adult', 'minor', 'unknown']), decision: z.enum(['pending', 'consented', 'obscure', 'exclude']),
        consentValid: z.boolean().optional(), consentScopeMismatch: z.boolean().optional(),
      })),
      namingNotAllowed: z.boolean().optional(), sensitiveTextData: z.boolean().optional(),
    }).parse(request.body)
    return evaluateMediaGate(input)
  })
}
