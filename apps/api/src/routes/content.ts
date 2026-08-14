import {
  CreateCompositionSessionSchema,
  CreateCustomStyleProfileRequestSchema,
  CreateGenerationCommandSchema,
  CreateSubmissionSchema,
  CustomStyleProfileSchema,
  GeneratedPostSchema,
  GenerationCandidateStatusSchema,
  PreviewCustomStyleProfileRequestSchema,
  StyleProfileRulesSchema,
  SubmissionAcceptedSchema,
  TeamSchema,
  UpdateCustomStyleProfileRequestSchema,
  UuidSchema,
  type StyleProfileRules,
  type Team,
} from '@vereinsfunk/contracts'
import { assertGroundedPost, createGroundedContentBrief, FakeContentGenerator, factsFromClubEvent, factsFromFixture } from '@vereinsfunk/content-engine'
import { createIdempotencyKey, evaluateMediaGate, evaluateSubmitPermission } from '@vereinsfunk/domain'
import type { FastifyInstance } from 'fastify'
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { CLUB_EVENT_COLUMNS, FIXTURE_COLUMNS, mapClubEventRow, mapFixtureRow, mapTeamRow } from '../apiMappers.js'
import type { ApiRouteContext } from './context.js'
import { buildStyleProfilePromptPreview, checkRateLimit, createAuditRecorder, fetchMemberTrust, previewStyleProfile, resolveDirectoryScope, resolvePreviewIdempotencyKey, resolveScopedEffectiveConfig, TEXT_GENERATION_DEFAULT_MAX_OUTPUT_TOKENS, toPermissionScope } from './shared.js'

// Plan 033 text-only workshop. Diese Routen rufen kein LLM auf: sie schreiben Sitzung und einen
// reinen ID-Umschlag ueber eine service-only RPC, die der Worker spaeter ausfuehrt.
const systemStyleProfiles: Record<string, { name: string; description: string; styleRules: StyleProfileRules; avoidRules: string[]; doRules: string[] }> = {
  klar_erklaerend: { name: 'Klar erklärend', description: 'Sachlich, verständlich und direkt.', styleRules: { toneTags: ['klar', 'sachlich'], catchphrases: [], examples: [{ input: '3:1 Sieg im Lokalderby, Tore: Müller, Meier, 500 Zuschauer', output: '3:1 gegen den Lokalrivalen. Müller und Meier trafen vor 500 Zuschauern – ein klarer Auftritt unserer Mannschaft.' }], additionalInstructions: '' }, avoidRules: ['Superlative ohne Beleg'], doRules: [] },
  warm_gemeinschaftlich: { name: 'Warm gemeinschaftlich', description: 'Einladend und verbunden.', styleRules: { toneTags: ['warm', 'gemeinschaftlich', 'einladend'], catchphrases: ['unsere Gemeinschaft'], examples: [{ input: 'Vereinsfest am Samstag, alle Abteilungen dabei', output: 'Am Samstag feiern wir gemeinsam – alle Abteilungen unter einem Dach. Schön, dass wir das als Gemeinschaft erleben dürfen.' }], additionalInstructions: '' }, avoidRules: [], doRules: ['Zusammenhalt/Gemeinschaft erwähnen'] },
  lebendig_sportlich: { name: 'Lebendig sportlich', description: 'Aktiv und motivierend.', styleRules: { toneTags: ['lebendig', 'sportlich', 'motivierend'], catchphrases: ['Vollgas'], examples: [{ input: 'Sieg im Auswärtsspiel, 2:0, starke zweite Halbzeit', output: '2:0 auswärts! Nach der Pause volle Power – so geht Einsatz.' }], additionalInstructions: '' }, avoidRules: [], doRules: ['Energie/Tempo im Text spürbar machen'] },
  leicht_humorvoll: { name: 'Leicht humorvoll', description: 'Freundlich mit zurückhaltendem Humor.', styleRules: { toneTags: ['humorvoll', 'freundlich', 'locker'], catchphrases: [], examples: [{ input: 'Trainingsauftakt nach der Sommerpause, alle etwas außer Form', output: 'Nach der Sommerpause ächzten die Beine beim ersten Sprint – aber der Spaß war sofort wieder da.' }], additionalInstructions: '' }, avoidRules: ['Ironie auf Kosten Einzelner'], doRules: [] },
  feierlich_wertschaetzend: { name: 'Feierlich wertschätzend', description: 'Dankbar und respektvoll.', styleRules: { toneTags: ['feierlich', 'dankbar', 'respektvoll'], catchphrases: [], examples: [{ input: '25 Jahre Vereinsmitgliedschaft von Herrn Schmidt', output: 'Seit 25 Jahren trägt Herr Schmidt unseren Verein mit – dafür sagen wir von Herzen Danke.' }], additionalInstructions: '' }, avoidRules: [], doRules: ['Dank/Anerkennung aussprechen'] },
}

const CUSTOM_STYLE_PROFILE_COLUMNS = 'id, organization_id, department_id, team_id, slug, name, description, style_rules, avoid_rules, do_rules, is_active, created_by, created_at, updated_at'
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

    // forbiddenTopics wird additiv zu doNotMention ergaenzt (Plan 011, "Durchsetzung an vier
    // Stellen") -- die Content-Engine kennt beide nicht getrennt, nur eine gemeinsame Verbotsliste.
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
          doNotMention: Array.from(new Set([...input.sourceMaterial.doNotMention, ...config.policies.forbiddenTopics])),
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
    const generated = await new FakeContentGenerator().generate(input)
    let draft: { postId: string; postVersionId: string } | null = null
    if (generated.missingFacts.length === 0) {
      // Schliesst die seit den Paketen 011/012/014/015/019 dokumentierte Luecke: bis hierhin
      // entstand nie ein post/post_version aus einer submission (plans/025). assertGroundedPost
      // setzt die in Plan 001 nur definierte, nie durchgesetzte Invariante erstmals durch --
      // mit FakeContentGenerator deterministisch nie verletzt, aber kein stilles Sicherheitsnetz.
      assertGroundedPost(generated, createGroundedContentBrief(input))

      // Geflacht, NICHT die unveraenderte EffectiveConfig-Verschachtelung: schedule_publication
      // und GET /v1/post-versions/:id/available-channels lesen bereits heute
      // effective_config_snapshot->'config'->'allowedChannelIds' direkt, nicht
      // ->'config'->'policies'->'allowedChannelIds'. Da bisher nichts diese Spalte beschrieb, blieb
      // der Mismatch folgenlos -- als erster Schreibzugriff muss dieser Code die gelesene Form
      // treffen, sonst waere die Kanal-Beschraenkung aus 011/012 ab hier stillschweigend wirkungslos.
      const effectiveConfigSnapshot = { config: { tone: config.tone, goals: config.goals, hashtags: config.hashtags, ...config.policies } }

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

  const TextWorkshopScopeSchema = z.object({ organizationId: UuidSchema, departmentId: UuidSchema, teamId: UuidSchema.nullable().optional() })

  app.get('/v1/content-style-profiles', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const scope = TextWorkshopScopeSchema.parse(request.query)
    if (!(await requirePermission(request, reply, 'post.create', toPermissionScope(scope.organizationId, scope.departmentId, scope.teamId ?? null)))) return
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const rows = await client.from('content_style_profiles').select('id, slug, name, description, style_rules, avoid_rules, do_rules, department_id, team_id, created_by, created_at, updated_at, is_active').eq('organization_id', scope.organizationId).eq('is_active', true)
    if (rows.error) throw rows.error
    // Plan 037: platform-admin-curated personas are the third, global source alongside the
    // hardcoded system modes and each organization's own custom profiles -- no organization_id
    // filter, since platform_style_personas has none.
    const personaRows = await client.from('platform_style_personas').select('id, slug, name, description, style_rules, avoid_rules, do_rules').eq('is_active', true)
    if (personaRows.error) throw personaRows.error
    const systems = Object.entries(systemStyleProfiles).map(([slug, profile]) => ({ id: null, slug, kind: 'system', ...profile, isActive: true }))
    const personas = personaRows.data.map((row) => ({ id: row.id, slug: row.slug, kind: 'persona', name: row.name, description: row.description, styleRules: StyleProfileRulesSchema.parse(row.style_rules), avoidRules: row.avoid_rules, doRules: row.do_rules, isActive: true }))
    const customs = rows.data.map((row) => ({ id: row.id, slug: row.slug, kind: 'custom', name: row.name, description: row.description, styleRules: StyleProfileRulesSchema.parse(row.style_rules), avoidRules: row.avoid_rules, doRules: row.do_rules, isActive: row.is_active }))
    return reply.send({ profiles: [...systems, ...personas, ...customs] })
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
    if (input.mediaAssetIds.length > 0 || input.requestedFormats.some((format) => format !== 'text_post')) return reply.code(422).send({ error: 'text_only_pilot' })
    const scope = toPermissionScope(input.organizationId, input.departmentId, input.teamId ?? null)
    if (!(await requirePermission(request, reply, 'post.create', scope))) return
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const config = await resolveScopedEffectiveConfig(client, input.organizationId, input.departmentId, input.teamId ?? null)
    if (config.policies.allowedPresets?.length && !config.policies.allowedPresets.includes(input.presetSlug)) return reply.code(422).send({ error: 'preset_not_allowed' })
    let styleSnapshot: Record<string, unknown>
    const styleProfileId: string | null = input.styleProfileId ?? null
    if (styleProfileId) {
      const row = await client.from('content_style_profiles').select('id, name, description, style_rules, avoid_rules, do_rules, department_id, team_id').eq('id', styleProfileId).eq('organization_id', input.organizationId).eq('is_active', true).maybeSingle()
      if (row.error) throw row.error
      if (!row.data) return reply.code(404).send({ error: 'style_profile_not_found' })
      if ((row.data.department_id !== null && row.data.department_id !== input.departmentId) || (row.data.team_id !== null && row.data.team_id !== (input.teamId ?? null))) {
        return reply.code(404).send({ error: 'style_profile_not_found' })
      }
      styleSnapshot = { name: row.data.name, description: row.data.description, styleRules: StyleProfileRulesSchema.parse(row.data.style_rules), avoidRules: row.data.avoid_rules, doRules: row.data.do_rules }
    } else if (input.personaSlug) {
      // Plan 037: a platform persona has no organization_id/department_id/team_id to scope
      // against -- unlike styleProfileId above, only is_active gates it.
      const persona = await client.from('platform_style_personas').select('name, description, style_rules, avoid_rules, do_rules').eq('slug', input.personaSlug).eq('is_active', true).maybeSingle()
      if (persona.error) throw persona.error
      if (!persona.data) return reply.code(404).send({ error: 'persona_not_found' })
      styleSnapshot = { name: persona.data.name, description: persona.data.description, styleRules: StyleProfileRulesSchema.parse(persona.data.style_rules), avoidRules: persona.data.avoid_rules, doRules: persona.data.do_rules, slug: input.personaSlug }
    } else {
      const profile = systemStyleProfiles[input.systemStyleProfileSlug ?? 'klar_erklaerend']!
      styleSnapshot = { name: profile.name, description: profile.description, styleRules: profile.styleRules, avoidRules: profile.avoidRules, doRules: profile.doRules, slug: input.systemStyleProfileSlug ?? 'klar_erklaerend' }
    }
    const sourceMaterial = { ...input.sourceMaterial, doNotMention: Array.from(new Set([...input.sourceMaterial.doNotMention, ...config.policies.forbiddenTopics])) }
    const sessionHash = createHash('sha256').update(JSON.stringify({ presetSlug: input.presetSlug, goal: input.communicationGoal, sourceMaterial, styleSnapshot, sourceRevision: input.sourceRevision })).digest('hex')
    const candidateHash = createHash('sha256').update(`${sessionHash}:initial`).digest('hex')
    const idempotencyKey = `generate-text:${sessionHash}:${input.sourceRevision}`
    const service = supabaseClients.forService()
    // Aufgeloest bei Anlage, danach eingefroren (siehe composition_sessions.max_output_tokens):
    // expliziter Request-Wert > Plattform-Vorgabe > generischer Fallback.
    let maxOutputTokens = input.maxOutputTokens ?? null
    if (maxOutputTokens === null && input.targetPlatform) {
      const platformDefault = await service.from('text_generation_platform_defaults').select('max_output_tokens').eq('platform', input.targetPlatform).maybeSingle()
      if (platformDefault.error) throw platformDefault.error
      maxOutputTokens = platformDefault.data?.max_output_tokens ?? null
    }
    const result = await service.rpc('create_text_generation_session', {
      p_organization_id: input.organizationId, p_department_id: input.departmentId, p_team_id: input.teamId ?? null, p_preset_slug: input.presetSlug,
      p_communication_goal: input.communicationGoal, p_requested_formats: input.requestedFormats, p_source_material: sourceMaterial,
      p_style_profile_id: styleProfileId, p_style_profile_snapshot: styleSnapshot, p_effective_config_snapshot: { config: { tone: config.tone, goals: config.goals, hashtags: config.hashtags, ...config.policies } },
      p_target_platform: input.targetPlatform ?? null, p_max_output_tokens: maxOutputTokens ?? TEXT_GENERATION_DEFAULT_MAX_OUTPUT_TOKENS, p_temperature: input.temperature,
      p_source_revision: input.sourceRevision, p_input_hash: sessionHash, p_candidate_input_hash: candidateHash, p_generation_intent: 'initial', p_revision_instruction: null,
      p_created_by: request.auth!.userId, p_correlation_id: request.id, p_idempotency_key: idempotencyKey,
    })
    if (result.error) throw result.error
    return reply.code(202).send({ ...z.object({ sessionId: UuidSchema, candidateId: UuidSchema }).parse(result.data), correlationId: request.id })
  })

  const TextWorkshopCandidateSchema = z.object({
    id: UuidSchema, status: GenerationCandidateStatusSchema, generated_content: GeneratedPostSchema.nullable(),
    quality_flags: z.array(z.string()), failure_code: z.string().nullable(), triggered_by: z.enum(['member', 'automatic_recovery']),
    accepted_post_version_id: UuidSchema.nullable(), created_at: z.string(),
  })
  app.get('/v1/text-workshop/sessions/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const id = z.object({ id: UuidSchema }).parse(request.params).id
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const session = await client.from('composition_sessions').select('id, organization_id, department_id, team_id, status, preset_slug, communication_goal, created_at').eq('id', id).maybeSingle()
    if (session.error) throw session.error
    if (!session.data) return reply.code(404).send({ error: 'session_not_found' })
    if (!(await requirePermission(request, reply, 'post.create', toPermissionScope(session.data.organization_id, session.data.department_id, session.data.team_id)))) return
    const candidates = await client.from('generation_candidates').select('id, status, generated_content, quality_flags, failure_code, triggered_by, accepted_post_version_id, created_at').eq('composition_session_id', id).order('created_at', { ascending: false })
    if (candidates.error) throw candidates.error
    return reply.send({ session: session.data, candidates: z.array(TextWorkshopCandidateSchema).parse(candidates.data) })
  })

  app.post('/v1/text-workshop/sessions/:id/generations', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const sessionId = z.object({ id: UuidSchema }).parse(request.params).id
    const command = CreateGenerationCommandSchema.parse({ ...z.object({ generationIntent: z.literal('revise'), revisionInstruction: z.string().trim().min(1).max(500) }).parse(request.body), sessionId })
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const session = await client
      .from('composition_sessions')
      .select('id, organization_id, department_id, team_id, preset_slug, communication_goal, requested_formats, source_material, style_profile_id, style_profile_snapshot, effective_config_snapshot, target_platform, max_output_tokens, temperature, source_revision, input_hash, created_by')
      .eq('id', sessionId)
      .maybeSingle()
    if (session.error) throw session.error
    if (!session.data) return reply.code(404).send({ error: 'session_not_found' })
    if (!(await requirePermission(request, reply, 'post.create', toPermissionScope(session.data.organization_id, session.data.department_id, session.data.team_id)))) return
    const revisionInstruction = command.revisionInstruction!
    const candidateHash = createHash('sha256').update(`${session.data.input_hash}:revise:${revisionInstruction}`).digest('hex')
    const service = supabaseClients.forService()
    const result = await service.rpc('create_text_generation_session', {
      p_organization_id: session.data.organization_id, p_department_id: session.data.department_id, p_team_id: session.data.team_id,
      p_preset_slug: session.data.preset_slug, p_communication_goal: session.data.communication_goal, p_requested_formats: session.data.requested_formats,
      p_source_material: session.data.source_material, p_style_profile_id: session.data.style_profile_id,
      p_style_profile_snapshot: session.data.style_profile_snapshot, p_effective_config_snapshot: session.data.effective_config_snapshot,
      p_target_platform: session.data.target_platform, p_max_output_tokens: session.data.max_output_tokens, p_temperature: session.data.temperature,
      p_source_revision: session.data.source_revision, p_input_hash: session.data.input_hash, p_candidate_input_hash: candidateHash,
      p_generation_intent: 'revise', p_revision_instruction: revisionInstruction, p_created_by: request.auth!.userId,
      p_correlation_id: request.id, p_idempotency_key: `generate-text:${candidateHash}`,
    })
    if (result.error) throw result.error
    return reply.code(202).send({ ...z.object({ sessionId: UuidSchema, candidateId: UuidSchema }).parse(result.data), correlationId: request.id })
  })

  app.post('/v1/text-workshop/candidates/:id/accept', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const id = z.object({ id: UuidSchema }).parse(request.params).id
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const candidate = await client.from('generation_candidates').select('organization_id, composition_session_id').eq('id', id).maybeSingle()
    if (candidate.error) throw candidate.error
    if (!candidate.data) return reply.code(404).send({ error: 'candidate_not_found' })
    const session = await client.from('composition_sessions').select('department_id, team_id').eq('id', candidate.data.composition_session_id).single()
    if (session.error) throw session.error
    if (!(await requirePermission(request, reply, 'post.create', toPermissionScope(candidate.data.organization_id, session.data.department_id, session.data.team_id)))) return
    const service = supabaseClients.forService()
    const accepted = await service.rpc('accept_text_generation_candidate', { p_candidate_id: id, p_actor_user_id: request.auth!.userId })
    if (accepted.error) throw accepted.error
    return reply.send(accepted.data)
  })

  const UploadInitiateSchema = z.object({ organizationId: UuidSchema, departmentId: UuidSchema, filename: z.string().min(1).max(120).regex(/^[^/\\]+$/), mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'video/mp4']), byteSize: z.int().positive().max(100 * 1024 * 1024) })
  app.post('/v1/media/uploads', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const input = UploadInitiateSchema.parse(request.body); const assetId = randomUUID()
    if (!(await requirePermission(request, reply, 'post.create', { organizationId: input.organizationId, departmentId: input.departmentId }))) return
    const service = supabaseClients.forService()
    // Plan 021: geprueft wird VOR dem Ausstellen der signierten URL, nicht erst nach dem Hochladen
    // -- sonst laege das Objekt schon im Bucket, wenn die Grenze auffiel. reserve_storage_upload()
    // prueft und reserviert atomar unter einer Vereinssperre (dieselbe Begruendung wie
    // enforce_structure_limit()/schedule_publication(): zwei parallele Uploads knapp unter der
    // Grenze duerfen sie nicht gemeinsam ueberschreiten -- eine getrennte TS-seitige Pruefung vor
    // einem ungesperrten insert liesse genau das zu, gefunden im eigenen Review dieser PR).
    // object_path folgt demselben Muster wie LocalUploadService.create() unten, weil die echte
    // Pfadvergabe dort passiert und hier noch nicht bekannt ist.
    const reservation = await service.rpc('reserve_storage_upload', {
      target_organization: input.organizationId, target_department: input.departmentId, target_asset_id: assetId,
      target_bucket_id: 'raw-media', target_object_path: `organizations/${input.organizationId}/departments/${input.departmentId}/assets/${assetId}/${input.filename}`,
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
    // Keine requirePermission-Pruefung: welchem Verein/Abteilung ein assetId gehoert, ist
    // erst bekannt, wenn media_assets echt persistiert wird (LocalUploadService ist noch
    // ein Stub). Sobald das der Fall ist, muss hier die Zugehoerigkeit nachgeschlagen und
    // gegen 'post.edit' geprueft werden -- sonst kann jeder authentifizierte Nutzer ein
    // fremdes assetId abschliessen.
    const params = z.object({ assetId: UuidSchema }).parse(request.params); const body = z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/i) }).parse(request.body)
    return reply.code(202).send(await uploads.complete({ ...params, ...body }))
  })
  app.post('/v1/media/gate', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    // Keine requirePermission-Pruefung: reine, zustandslose Regelauswertung ohne Scope-Bezug
    // und ohne Datenzugriff -- es gibt nichts scope-Gebundenes, gegen das zu pruefen waere.
    const input = z.object({
      scanStatus: z.enum(['pending', 'clean', 'failed']), facesConfirmedComplete: z.boolean(), hasOriginalSelected: z.boolean(),
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
