import { randomUUID } from 'node:crypto'
import {
  PlayerboardVeoLinkRequestSchema,
  PlayerboardVeoLoginRequestSchema,
  PlayerboardVeoLoginResponseSchema,
  PlayerboardVeoStatusSchema,
  PlayerboardVeoSyncAcceptedSchema,
  PlayerboardVeoSyncRequestSchema,
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
import { loadTeamScope } from './shared.js'
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
