import { ChannelQuotaSchema, CreateChannelQuotaRequestSchema, UpdateChannelQuotaRequestSchema, UuidSchema, type ScopeLevel } from '@vereinsfunk/contracts'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ApiRouteContext } from './context.js'
import { isAnyMemberOfOrganization, POLICY_MANAGE_PERMISSION, resolveMembershipScope, toPermissionScope } from './shared.js'

export function registerChannelQuotaRoutes(app: FastifyInstance, context: ApiRouteContext): void {
  const { requireAuth, requirePermission, supabaseClients } = context

  app.get('/v1/organizations/:id/channel-quotas', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    if (!(await isAnyMemberOfOrganization(client, request.auth!.userId, params.id))) {
      return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
    }
    const rows = await client.from('channel_quotas').select('id, scope, department_id, team_id, social_connection_id, period, max_publications').eq('organization_id', params.id)
    if (rows.error) throw rows.error
    return reply.code(200).send(
      rows.data.map((row) =>
        ChannelQuotaSchema.parse({
          id: row.id, scope: row.scope, scopeId: row.team_id ?? row.department_id ?? params.id, socialConnectionId: row.social_connection_id,
          period: row.period, maxPublications: row.max_publications,
        }),
      ),
    )
  })

  app.post('/v1/channel-quotas', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const input = CreateChannelQuotaRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const scope = await resolveMembershipScope(client, input.scope, input.scopeId)
    if (!scope) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, POLICY_MANAGE_PERMISSION[input.scope], scope))) return
    const insert = await client
      .from('channel_quotas')
      .insert({
        organization_id: scope.organizationId, scope: input.scope, department_id: scope.departmentId ?? null, team_id: scope.teamId ?? null,
        social_connection_id: input.socialConnectionId ?? null, period: input.period, max_publications: input.maxPublications,
      })
      .select('id, scope, department_id, team_id, social_connection_id, period, max_publications')
      .single()
    if (insert.error) {
      if (insert.error.code === '23505') return reply.code(409).send({ error: 'quota_already_exists', correlationId: request.id })
      // 23503 = foreign_key_violation, z. B. ein nicht existierender socialConnectionId.
      if (insert.error.code === '23503') return reply.code(404).send({ error: 'not_found', correlationId: request.id })
      throw insert.error
    }
    return reply.code(201).send(
      ChannelQuotaSchema.parse({
        id: insert.data.id, scope: insert.data.scope, scopeId: input.scopeId, socialConnectionId: insert.data.social_connection_id,
        period: insert.data.period, maxPublications: insert.data.max_publications,
      }),
    )
  })

  app.patch('/v1/channel-quotas/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = UpdateChannelQuotaRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const existing = await client.from('channel_quotas').select('organization_id, scope, department_id, team_id').eq('id', params.id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const scope = toPermissionScope(existing.data.organization_id as string, existing.data.department_id as string | null, existing.data.team_id as string | null)
    if (!(await requirePermission(request, reply, POLICY_MANAGE_PERMISSION[existing.data.scope as ScopeLevel], scope))) return
    const update = await client.from('channel_quotas').update({ max_publications: input.maxPublications }).eq('id', params.id).select('id, scope, department_id, team_id, social_connection_id, period, max_publications')
    if (update.error) throw update.error
    // Wie bei DELETE unten: filtert RLS die Zielzeile aus dem UPDATE, trifft die Anweisung null
    // Zeilen ohne Fehler. Ein abschliessendes .single() haette daraus einen 500 gemacht statt eines
    // 403 (derselbe Grund wie bei DELETE /v1/departments/:id, siehe Kommentar dort).
    const updated = update.data[0]
    if (!updated) return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
    return reply.code(200).send(
      ChannelQuotaSchema.parse({
        id: updated.id, scope: updated.scope, scopeId: updated.team_id ?? updated.department_id ?? existing.data.organization_id,
        socialConnectionId: updated.social_connection_id, period: updated.period, maxPublications: updated.max_publications,
      }),
    )
  })

  app.delete('/v1/channel-quotas/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const existing = await client.from('channel_quotas').select('organization_id, scope, department_id, team_id').eq('id', params.id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const scope = toPermissionScope(existing.data.organization_id as string, existing.data.department_id as string | null, existing.data.team_id as string | null)
    if (!(await requirePermission(request, reply, POLICY_MANAGE_PERMISSION[existing.data.scope as ScopeLevel], scope))) return
    const del = await client.from('channel_quotas').delete().eq('id', params.id).select('id')
    if (del.error) throw del.error
    if (del.data.length === 0) return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
    return reply.code(204).send()
  })
}
