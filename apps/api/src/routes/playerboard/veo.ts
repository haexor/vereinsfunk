import { randomUUID } from 'node:crypto'
import {
  AssignPlayerboardVeoJerseyRequestSchema,
  AssignPlayerboardVeoJerseyResponseSchema,
  PlayerboardRankingQuerySchema,
  PlayerboardVeoConflictSchema,
  PlayerboardVeoLinkRequestSchema,
  PlayerboardVeoMatchSchema,
  PlayerboardVeoLoginRequestSchema,
  PlayerboardVeoLoginResponseSchema,
  PlayerboardVeoStatusSchema,
  PlayerboardVeoSyncAcceptedSchema,
  PlayerboardVeoSyncRequestSchema,
  ResolvePlayerboardVeoConflictRequestSchema,
  SyncIdempotencyKeySchema,
  UuidSchema,
} from '@vereinsfunk/contracts'
import { captureSessionViaLogin, exchangeSessionCookieForToken, listClubTeams, listOwnClubs, VeoError } from '@vereinsfunk/veo-client'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { ciphertextToBytea, createSecretBoxFromEnvironment } from '../../secretBox.js'
import { enqueueIntegrationSync, isSourceDisabledError } from '../../services/integrationQueue.js'
import type { ApiRouteContext } from '../context.js'
import { createAuditRecorder } from '../shared.js'
import { loadTeamScope, requireStatsAccess, sendDatabaseError } from './shared.js'
import { openVeoLinkToken, sealVeoLinkToken, type VeoTeamChoice } from './veoLinkToken.js'

// Paket 053, PR 2: Veo verbinden und abgleichen. Der Trainer (playerboard.manage auf der
// Mannschaft) meldet sich einmalig bei Veo an, waehlt die Veo-Mannschaft und bekommt damit genau
// eine Integrationsquelle fuer die eigene Mannschaft. Abgeglichen wird im Worker.

// Ein Login startet ein ganzes Chromium; mehr als zwei gleichzeitig lohnen den Speicher nicht.
const MAX_CONCURRENT_LOGINS = 2

type LinkRow = {
  team_id: string
  organization_id: string
  integration_source_id: string
  veo_club_name: string
  veo_team_name: string
  consecutive_failures: number
  last_error_code: string | null
}
type RunRow = {
  id: string; status: string; started_at: string; finished_at: string | null
  created_count: number; updated_count: number; skipped_count: number; conflict_count: number; error_class: string | null
}

/** Uebersetzt einen Fehler aus dem Veo-Client in eine fachliche Antwort; andere Fehler gehen weiter. */
function sendVeoError(request: FastifyRequest, reply: FastifyReply, error: unknown): boolean {
  if (!(error instanceof VeoError)) return false
  if (error.code === 'login_failed' || error.code === 'auth_expired') {
    reply.code(422).send({ error: 'veo_login_failed', correlationId: request.id })
  } else {
    reply.code(502).send({ error: error.code === 'upstream_changed' ? 'veo_upstream_changed' : 'veo_unavailable', correlationId: request.id })
  }
  return true
}

/** Laedt die Veo-Verbindung einer Mannschaft per Service-Client (Quelle und Laeufe sind nur fuer integration.manage per RLS lesbar). */
async function loadLink(service: SupabaseClient, teamId: string): Promise<LinkRow | null> {
  const link = await service
    .from('playerboard_veo_links')
    .select('team_id, organization_id, integration_source_id, veo_club_name, veo_team_name, consecutive_failures, last_error_code')
    .eq('team_id', teamId)
    .maybeSingle()
  if (link.error) throw link.error
  return link.data ? z.object({
    team_id: UuidSchema,
    organization_id: UuidSchema,
    integration_source_id: UuidSchema,
    veo_club_name: z.string().min(1),
    veo_team_name: z.string().min(1),
    consecutive_failures: z.number().int().nonnegative(),
    last_error_code: z.string().nullable(),
  }).parse(link.data) : null
}

/** Baut den Verbindungsstatus samt der letzten zehn Laeufe. */
async function loadStatus(service: SupabaseClient, teamId: string) {
  const link = await loadLink(service, teamId)
  let runs: RunRow[] = []
  if (link) {
    const loaded = await service
      .from('integration_sync_runs')
      .select('id, status, started_at, finished_at, created_count, updated_count, skipped_count, conflict_count, error_class')
      .eq('source_id', link.integration_source_id)
      .order('started_at', { ascending: false })
      .limit(10)
    if (loaded.error) throw loaded.error
    runs = loaded.data as RunRow[]
  }
  return PlayerboardVeoStatusSchema.parse({
    teamId,
    linked: link !== null,
    veoClubName: link?.veo_club_name ?? null,
    veoTeamName: link?.veo_team_name ?? null,
    consecutiveFailures: link?.consecutive_failures ?? 0,
    lastErrorCode: link?.last_error_code ?? null,
    needsReconnect: link?.last_error_code === 'auth_expired',
    runs: runs.map((run) => ({
      id: run.id, status: run.status, startedAt: run.started_at, finishedAt: run.finished_at,
      createdCount: run.created_count, updatedCount: run.updated_count, skippedCount: run.skipped_count,
      conflictCount: run.conflict_count, errorClass: run.error_class,
    })),
  })
}

/** Liest den optionalen Idempotency-Key-Header; undefined bei ungueltigem Wert. */
function readIdempotencyKey(request: FastifyRequest): string | undefined {
  const header = request.headers['idempotency-key']
  if (Array.isArray(header)) return undefined
  const parsed = SyncIdempotencyKeySchema.safeParse(typeof header === 'string' ? header : randomUUID())
  return parsed.success ? parsed.data : undefined
}

type ConflictRow = { id: string; source_id: string; label: string; current_value: string | null; incoming_value: string | null }

/** Offene mehrdeutige Veo-Spiele einer Quelle samt der Spielplan-Kandidaten, die der Abgleich gefunden hat. */
async function loadConflicts(service: SupabaseClient, sourceId: string) {
  const conflicts = await service
    .from('integration_sync_conflicts')
    .select('id, source_id, label, current_value, incoming_value')
    .eq('source_id', sourceId)
    .eq('kind', 'ambiguous_match')
    .eq('resolution', 'pending')
    .order('created_at', { ascending: true })
  if (conflicts.error) throw conflicts.error
  const rows = conflicts.data as ConflictRow[]
  const candidateIds = [...new Set(rows.flatMap((row) => (row.current_value ?? '').split(',').filter((id) => UuidSchema.safeParse(id).success)))]
  const fixtures = new Map<string, { id: string; kickoff_at: string | null; opponent_name: string | null; is_home: boolean | null }>()
  if (candidateIds.length) {
    // Bereits einem anderen Veo-Spiel zugeordnete Kandidaten fallen weg.
    const loaded = await service.from('fixtures').select('id, kickoff_at, opponent_name, is_home').in('id', candidateIds)
    if (loaded.error) throw loaded.error
    const mapped = await service.from('playerboard_veo_matches').select('fixture_id').in('fixture_id', candidateIds)
    if (mapped.error) throw mapped.error
    const taken = new Set((mapped.data as { fixture_id: string }[]).map((row) => row.fixture_id))
    for (const fixture of loaded.data as { id: string; kickoff_at: string | null; opponent_name: string | null; is_home: boolean | null }[]) {
      if (!taken.has(fixture.id)) fixtures.set(fixture.id, fixture)
    }
  }
  return rows.map((row) => PlayerboardVeoConflictSchema.parse({
    id: row.id,
    label: row.label,
    // Aeltere Konflikte (vor PR 3) tragen hier noch die Veo-Spiel-ID statt des Starts.
    veoStart: row.incoming_value && !Number.isNaN(Date.parse(row.incoming_value)) ? row.incoming_value : null,
    candidates: (row.current_value ?? '').split(',').flatMap((id) => {
      const fixture = fixtures.get(id)
      return fixture ? [{ fixtureId: fixture.id, kickoffAt: fixture.kickoff_at, opponentName: fixture.opponent_name, isHome: fixture.is_home }] : []
    }),
  }))
}

/** Registriert Anmeldung, Verbindung, Status und manuellen Abgleich der Veo-Anbindung. */
export function registerPlayerboardVeoRoutes(app: FastifyInstance, context: ApiRouteContext): void {
  const { requireAuth, requirePermission, supabaseClients } = context
  const recordAuditEvent = createAuditRecorder(supabaseClients)
  let activeLogins = 0

  // Anmeldung: E-Mail und Passwort gehen nur an Veos Login-Seite im Browser, nie in Log oder Datenbank.
  app.post('/v1/playerboard/veo/login', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const input = PlayerboardVeoLoginRequestSchema.parse(request.body)
    const service = supabaseClients.forService()
    const scope = await loadTeamScope(service, input.teamId)
    if (!scope) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, 'playerboard.manage', scope))) return
    if (activeLogins >= MAX_CONCURRENT_LOGINS) return reply.code(503).send({ error: 'veo_login_busy', correlationId: request.id })

    activeLogins += 1
    let cookie: string
    const choices: VeoTeamChoice[] = []
    const clubs: { slug: string; name: string; teams: { slug: string; name: string }[] }[] = []
    try {
      cookie = await captureSessionViaLogin(input.email, input.password, context.veo.launchBrowser)
      const { accessToken } = await exchangeSessionCookieForToken(cookie, { fetch: context.veo.fetch })
      for (const club of await listOwnClubs(accessToken, { fetch: context.veo.fetch })) {
        const teams = await listClubTeams(accessToken, club.slug, { fetch: context.veo.fetch })
        clubs.push({ slug: club.slug, name: club.name, teams })
        for (const team of teams) choices.push({ clubSlug: club.slug, clubName: club.name, teamSlug: team.slug, teamName: team.name })
      }
    } catch (error) {
      if (sendVeoError(request, reply, error)) return
      throw error
    } finally {
      activeLogins -= 1
    }

    const linkToken = sealVeoLinkToken(createSecretBoxFromEnvironment(context.environment), {
      teamId: input.teamId, userId: request.auth!.userId, cookie, teams: choices,
    })
    return reply.send(PlayerboardVeoLoginResponseSchema.parse({ linkToken, clubs }))
  })

  // Verbinden bzw. neu verbinden: Quelle, versiegeltes Cookie und Verbindung in einer Transaktion,
  // danach sofort der erste Abgleich (ganze Historie).
  app.post('/v1/playerboard/veo/link', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const input = PlayerboardVeoLinkRequestSchema.parse(request.body)
    const service = supabaseClients.forService()
    const scope = await loadTeamScope(service, input.teamId)
    if (!scope) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, 'playerboard.manage', scope))) return

    const box = createSecretBoxFromEnvironment(context.environment)
    const token = openVeoLinkToken(box, input.linkToken, { teamId: input.teamId, userId: request.auth!.userId })
    if (!token) return reply.code(400).send({ error: 'invalid_link_token', correlationId: request.id })
    const choice = token.teams.find((team) => team.clubSlug === input.veoClubSlug && team.teamSlug === input.veoTeamSlug)
    if (!choice) return reply.code(422).send({ error: 'veo_team_not_available', correlationId: request.id })

    const existing = await loadLink(service, input.teamId)
    const sourceId = existing?.integration_source_id ?? randomUUID()
    const sealed = box.seal(token.cookie, `integration-source:${sourceId}`)
    const linked = await service.rpc('playerboard_veo_link_team', {
      p_team_id: input.teamId, p_source_id: sourceId,
      p_secret_ciphertext: ciphertextToBytea(sealed.ciphertext), p_key_version: sealed.keyVersion,
      p_veo_club_slug: choice.clubSlug, p_veo_club_name: choice.clubName,
      p_veo_team_slug: choice.teamSlug, p_veo_team_name: choice.teamName,
      p_user_id: request.auth!.userId,
    })
    if (linked.error) {
      if (linked.error.message?.includes('veo_link_changed')) return reply.code(409).send({ error: 'veo_link_changed', correlationId: request.id })
      throw linked.error
    }

    await recordAuditEvent(request, {
      organizationId: scope.organizationId, action: existing ? 'playerboard.veo_relinked' : 'playerboard.veo_linked',
      entityType: 'integration_source', entityId: sourceId,
      metadata: { teamId: input.teamId, veoClubSlug: choice.clubSlug, veoTeamSlug: choice.teamSlug },
    })
    await enqueueIntegrationSync(service, {
      organizationId: scope.organizationId, sourceId, idempotencyKey: `link:${randomUUID()}`, triggeredBy: request.auth!.userId,
    })
    return reply.code(201).send(await loadStatus(service, input.teamId))
  })

  app.get('/v1/playerboard/veo/status', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const query = z.object({ teamId: UuidSchema }).parse(request.query)
    const service = supabaseClients.forService()
    const scope = await loadTeamScope(service, query.teamId)
    if (!scope) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, 'training.view', scope))) return
    return reply.send(await loadStatus(service, query.teamId))
  })

  // Spiele mit Veo-Werten im Zeitraum, fuer alle, die die Kennzahlen der Mannschaft sehen.
  app.get('/v1/playerboard/teams/:teamId/veo/matches', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ teamId: UuidSchema }).parse(request.params)
    const query = PlayerboardRankingQuerySchema.parse(request.query)
    const scope = await loadTeamScope(supabaseClients.forService(), params.teamId)
    if (!scope) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requireStatsAccess(context, request, reply, scope))) return
    const matches = await supabaseClients.forUser(request.auth!.accessToken).rpc('playerboard_veo_team_matches', {
      target_team_id: params.teamId, from_date: query.from ?? null, to_date: query.to ?? null,
    })
    if (matches.error) {
      if (sendDatabaseError(request, reply, matches.error)) return
      throw matches.error
    }
    return reply.send(z.array(PlayerboardVeoMatchSchema).parse(matches.data ?? []))
  })

  // Rueckennummer eines Spiels einem Kader-Eintrag zuordnen (oder bewusst offen lassen).
  app.put('/v1/playerboard/veo/assignments', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const input = AssignPlayerboardVeoJerseyRequestSchema.parse(request.body)
    const service = supabaseClients.forService()
    const mapped = await service.from('playerboard_veo_matches').select('team_id').eq('fixture_id', input.fixtureId).maybeSingle()
    if (mapped.error) throw mapped.error
    if (!mapped.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const scope = await loadTeamScope(service, mapped.data.team_id as string)
    if (!scope) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, 'training.manage', scope))) return
    const assigned = await supabaseClients.forUser(request.auth!.accessToken).rpc('playerboard_veo_assign_jersey', {
      p_fixture_id: input.fixtureId, p_jersey_number: input.jerseyNumber, p_player_id: input.playerId, p_apply_to_unassigned: input.applyToUnassigned,
    })
    if (assigned.error) {
      if (sendDatabaseError(request, reply, assigned.error)) return
      throw assigned.error
    }
    return reply.send(AssignPlayerboardVeoJerseyResponseSchema.parse({ changed: assigned.data }))
  })

  app.get('/v1/playerboard/veo/conflicts', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const query = z.object({ teamId: UuidSchema }).parse(request.query)
    const service = supabaseClients.forService()
    const scope = await loadTeamScope(service, query.teamId)
    if (!scope) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, 'playerboard.manage', scope))) return
    const link = await loadLink(service, query.teamId)
    return reply.send(link ? await loadConflicts(service, link.integration_source_id) : [])
  })

  // Mehrdeutiges Spiel aufloesen und gleich neu abgleichen, damit die Werte erscheinen.
  app.post('/v1/playerboard/veo/conflicts/:id/resolve', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = ResolvePlayerboardVeoConflictRequestSchema.parse(request.body)
    const service = supabaseClients.forService()
    const conflict = await service.from('integration_sync_conflicts').select('source_id').eq('id', params.id).maybeSingle()
    if (conflict.error) throw conflict.error
    if (!conflict.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const link = await service.from('playerboard_veo_links').select('team_id').eq('integration_source_id', conflict.data.source_id as string).maybeSingle()
    if (link.error) throw link.error
    if (!link.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const scope = await loadTeamScope(service, link.data.team_id as string)
    if (!scope) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, 'playerboard.manage', scope))) return

    const resolved = await service.rpc('playerboard_veo_resolve_conflict', {
      p_conflict_id: params.id, p_action: input.action, p_fixture_id: input.action === 'fixture' ? input.fixtureId : null, p_user_id: request.auth!.userId,
    })
    if (resolved.error) {
      if (sendDatabaseError(request, reply, resolved.error)) return
      throw resolved.error
    }
    await recordAuditEvent(request, {
      organizationId: scope.organizationId, action: 'playerboard.veo_conflict_resolved', entityType: 'integration_sync_conflict', entityId: params.id,
      metadata: { action: input.action },
    })
    if (input.action === 'ignore') return reply.code(204).send()
    try {
      const queued = await enqueueIntegrationSync(service, {
        organizationId: scope.organizationId, sourceId: conflict.data.source_id as string, idempotencyKey: `resolve:${params.id}`, triggeredBy: request.auth!.userId,
      })
      return reply.code(202).send(PlayerboardVeoSyncAcceptedSchema.parse({ runId: queued.runId, state: queued.result === 'acquired' ? 'queued' : queued.result }))
    } catch (error) {
      // Die Aufloesung bleibt gespeichert; der naechste Abgleich wendet sie an.
      if (isSourceDisabledError(error)) return reply.code(204).send()
      throw error
    }
  })

  // Manueller Abgleich; derselbe Idempotency-Key liefert denselben Lauf (Paket 026).
  app.post('/v1/playerboard/veo/sync', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const input = PlayerboardVeoSyncRequestSchema.parse(request.body)
    const idempotencyKey = readIdempotencyKey(request)
    if (!idempotencyKey) return reply.code(400).send({ error: 'invalid_idempotency_key', correlationId: request.id })
    const service = supabaseClients.forService()
    const scope = await loadTeamScope(service, input.teamId)
    if (!scope) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, 'playerboard.manage', scope))) return
    const link = await loadLink(service, input.teamId)
    if (!link) return reply.code(404).send({ error: 'veo_not_linked', correlationId: request.id })

    let queued: Awaited<ReturnType<typeof enqueueIntegrationSync>>
    try {
      queued = await enqueueIntegrationSync(service, {
        organizationId: scope.organizationId, sourceId: link.integration_source_id, idempotencyKey, triggeredBy: request.auth!.userId,
      })
    } catch (error) {
      if (isSourceDisabledError(error)) {
        return reply.code(409).send({ error: 'source_disabled', correlationId: request.id })
      }
      throw error
    }
    if (queued.result === 'already_running') {
      return reply.code(409).send({ error: 'sync_already_running', runId: queued.runId, correlationId: request.id })
    }
    const state = queued.result === 'replay' ? 'replay' : 'queued'
    return reply.code(state === 'queued' ? 202 : 200).send(PlayerboardVeoSyncAcceptedSchema.parse({ runId: queued.runId, state }))
  })
}
