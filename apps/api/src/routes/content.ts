import {
  CreateSubmissionSchema,
  SubmissionAcceptedSchema,
  TeamSchema,
  UuidSchema,
  type Team,
} from '@vereinsfunk/contracts'
import { assertGroundedPost, createGroundedContentBrief, FakeContentGenerator, factsFromClubEvent, factsFromFixture } from '@vereinsfunk/content-engine'
import { createIdempotencyKey, evaluateSubmitPermission } from '@vereinsfunk/domain'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { parseSupabaseData } from '../supabase.js'
import { CLUB_EVENT_COLUMNS, FIXTURE_COLUMNS, mapClubEventRow, mapFixtureRow, mapTeamRow } from '../apiMappers.js'
import type { ApiRouteContext } from './context.js'
import { createAuditRecorder } from './shared.js'
import { fetchMemberTrust, resolveScopedEffectiveConfig } from '../services/policyRules.js'
import { toPermissionScope } from '../services/scopeAuthorization.js'

export const DeletableScopeSchema = z.object({ organization_id: UuidSchema, department_id: UuidSchema.nullable(), team_id: UuidSchema.nullable() })

export function registerContentRoutes(app: FastifyInstance, context: ApiRouteContext): void {
  const { requireAuth, requirePermission, supabaseClients } = context
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
            // Die Verfasserin traegt die Freigabepruefung: can_decide_stage schliesst sie ueber
            // created_by_user_id von der Selbstfreigabe aus, is_profile_minor erzwingt darueber die
            // Minderjaehrigenstufe. Ohne den Wert waere sie fuer beide Pruefungen unbekannt.
            created_by_type: 'llm', created_by_user_id: request.auth!.userId,
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
}
