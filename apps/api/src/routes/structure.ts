import {
  CreateDepartmentRequestSchema,
  CreateTeamRequestSchema,
  DepartmentSchema,
  TeamSchema,
  UpdateDepartmentRequestSchema,
  UpdateTeamRequestSchema,
  UuidSchema,
} from '@vereinsfunk/contracts'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { mapDepartmentRow, mapTeamRow } from '../apiMappers.js'
import type { ApiRouteContext } from './context.js'

export function registerStructureRoutes(app: FastifyInstance, context: ApiRouteContext): void {
  const { requireAuth, requirePermission, supabaseClients } = context

app.post('/v1/organizations/:orgId/departments', async (request, reply) => {
  if (!(await requireAuth(request, reply))) return
  const params = z.object({ orgId: UuidSchema }).parse(request.params)
  const input = CreateDepartmentRequestSchema.parse(request.body)
  if (!(await requirePermission(request, reply, 'department.manage', { organizationId: params.orgId }))) return
  const client = supabaseClients.forUser(request.auth!.accessToken)
  const rpc = await client.rpc('create_department', { target_organization_id: params.orgId, department_name: input.name })
  if (rpc.error) throw rpc.error
  const department = await client.from('departments').select('id, organization_id, name, slug, archived_at, created_at').eq('id', rpc.data as string).single()
  if (department.error) throw department.error
  // audit_events ist append-only und wird ausschliesslich privilegiert beschrieben ("Inserts
  // happen through privileged API procedures", 202608020001_initial_tenant_foundation.sql):
  // authenticated hat weder Insert-Grant noch Insert-Policy. Mit dem Nutzer-Client lief jeder
  // dieser Inserts in "permission denied for table audit_events", wurde nur geloggt und der
  // Request antwortete trotzdem mit 2xx -- der komplette Audit-Trail dieses Pakets war damit
  // wirkungslos (im Nachfolge-Review dieses PRs gefunden). Gilt fuer alle audit_events-Inserts
  // unten genauso; der Service-Client ist dasselbe Muster wie im Brand-Logo-Upload (Paket 022).
  const audit = await supabaseClients.forService().from('audit_events').insert({
    organization_id: params.orgId,
    actor_user_id: request.auth!.userId,
    action: 'department.created',
    entity_type: 'departments',
    entity_id: department.data.id,
    correlation_id: request.id,
    metadata: { name: input.name },
  })
  if (audit.error) request.log.error({ err: audit.error, correlationId: request.id }, 'audit_events insert failed')
  return reply.code(201).send(DepartmentSchema.parse(mapDepartmentRow(department.data)))
})

app.patch('/v1/departments/:id', async (request, reply) => {
  if (!(await requireAuth(request, reply))) return
  const params = z.object({ id: UuidSchema }).parse(request.params)
  const input = UpdateDepartmentRequestSchema.parse(request.body)
  const client = supabaseClients.forUser(request.auth!.accessToken)
  const existing = await client.from('departments').select('organization_id').eq('id', params.id).maybeSingle()
  if (existing.error) throw existing.error
  if (!existing.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
  if (!(await requirePermission(request, reply, 'department.manage', { organizationId: existing.data.organization_id as string }))) return
  const payload: Record<string, unknown> = {}
  if (input.name !== undefined) payload.name = input.name
  if (input.archived !== undefined) payload.archived_at = input.archived ? new Date().toISOString() : null
  const update = await client.from('departments').update(payload).eq('id', params.id).select('id, organization_id, name, slug, archived_at, created_at').single()
  if (update.error) throw update.error
  const audit = await supabaseClients.forService().from('audit_events').insert({
    organization_id: existing.data.organization_id,
    actor_user_id: request.auth!.userId,
    action: 'department.updated',
    entity_type: 'departments',
    entity_id: params.id,
    correlation_id: request.id,
    metadata: payload,
  })
  if (audit.error) request.log.error({ err: audit.error, correlationId: request.id }, 'audit_events insert failed')
  return reply.code(200).send(DepartmentSchema.parse(mapDepartmentRow(update.data)))
})

app.delete('/v1/departments/:id', async (request, reply) => {
  if (!(await requireAuth(request, reply))) return
  const params = z.object({ id: UuidSchema }).parse(request.params)
  const client = supabaseClients.forUser(request.auth!.accessToken)
  const existing = await client.from('departments').select('organization_id').eq('id', params.id).maybeSingle()
  if (existing.error) throw existing.error
  if (!existing.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
  if (!(await requirePermission(request, reply, 'department.manage', { organizationId: existing.data.organization_id as string }))) return
  const del = await client.from('departments').delete().eq('id', params.id).select('id')
  if (del.error) {
    if (del.error.message.includes('the last department')) return reply.code(409).send({ error: 'last_department_cannot_be_deleted', correlationId: request.id })
    if (del.error.message.includes('cannot be deleted')) return reply.code(409).send({ error: 'department_delete_blocked', correlationId: request.id })
    throw del.error
  }
  // PostgREST reports no error when RLS filters the target row out of a DELETE -- it simply
  // matches zero rows (see supabase/tests' pgTAP regression for this). Without checking the
  // returned row count, a caller without department.manage in this row's scope would see a
  // misleading 204 for a department that still exists (found in this package's review).
  if (del.data.length === 0) return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
  const audit = await supabaseClients.forService().from('audit_events').insert({
    organization_id: existing.data.organization_id,
    actor_user_id: request.auth!.userId,
    action: 'department.deleted',
    entity_type: 'departments',
    entity_id: params.id,
    correlation_id: request.id,
  })
  if (audit.error) request.log.error({ err: audit.error, correlationId: request.id }, 'audit_events insert failed')
  return reply.code(204).send()
})

app.post('/v1/departments/:id/teams', async (request, reply) => {
  if (!(await requireAuth(request, reply))) return
  const params = z.object({ id: UuidSchema }).parse(request.params)
  const input = CreateTeamRequestSchema.parse(request.body)
  const client = supabaseClients.forUser(request.auth!.accessToken)
  const department = await client.from('departments').select('organization_id').eq('id', params.id).maybeSingle()
  if (department.error) throw department.error
  if (!department.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
  if (!(await requirePermission(request, reply, 'team.manage', { organizationId: department.data.organization_id as string, departmentId: params.id }))) return
  const insert = await client
    .from('teams')
    .insert({ organization_id: department.data.organization_id, department_id: params.id, name: input.name })
    .select('id, organization_id, department_id, name, age_group, competition, source_id, archived_at, created_at')
    .single()
  if (insert.error) throw insert.error
  const audit = await supabaseClients.forService().from('audit_events').insert({
    organization_id: department.data.organization_id,
    actor_user_id: request.auth!.userId,
    action: 'team.created',
    entity_type: 'teams',
    entity_id: insert.data.id,
    correlation_id: request.id,
    metadata: { name: input.name, departmentId: params.id },
  })
  if (audit.error) request.log.error({ err: audit.error, correlationId: request.id }, 'audit_events insert failed')
  return reply.code(201).send(TeamSchema.parse(mapTeamRow(insert.data)))
})

app.patch('/v1/teams/:id', async (request, reply) => {
  if (!(await requireAuth(request, reply))) return
  const params = z.object({ id: UuidSchema }).parse(request.params)
  const input = UpdateTeamRequestSchema.parse(request.body)
  const client = supabaseClients.forUser(request.auth!.accessToken)
  const existing = await client.from('teams').select('organization_id, department_id').eq('id', params.id).maybeSingle()
  if (existing.error) throw existing.error
  if (!existing.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
  if (!(await requirePermission(request, reply, 'team.manage', { organizationId: existing.data.organization_id as string, departmentId: existing.data.department_id as string }))) return
  const payload: Record<string, unknown> = {}
  if (input.name !== undefined) payload.name = input.name
  if (input.archived !== undefined) payload.archived_at = input.archived ? new Date().toISOString() : null
  const update = await client.from('teams').update(payload).eq('id', params.id).select('id, organization_id, department_id, name, age_group, competition, source_id, archived_at, created_at').single()
  if (update.error) throw update.error
  const audit = await supabaseClients.forService().from('audit_events').insert({
    organization_id: existing.data.organization_id,
    actor_user_id: request.auth!.userId,
    action: 'team.updated',
    entity_type: 'teams',
    entity_id: params.id,
    correlation_id: request.id,
    metadata: payload,
  })
  if (audit.error) request.log.error({ err: audit.error, correlationId: request.id }, 'audit_events insert failed')
  return reply.code(200).send(TeamSchema.parse(mapTeamRow(update.data)))
})

app.delete('/v1/teams/:id', async (request, reply) => {
  if (!(await requireAuth(request, reply))) return
  const params = z.object({ id: UuidSchema }).parse(request.params)
  const client = supabaseClients.forUser(request.auth!.accessToken)
  const existing = await client.from('teams').select('organization_id, department_id').eq('id', params.id).maybeSingle()
  if (existing.error) throw existing.error
  if (!existing.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
  if (!(await requirePermission(request, reply, 'team.manage', { organizationId: existing.data.organization_id as string, departmentId: existing.data.department_id as string }))) return
  const del = await client.from('teams').delete().eq('id', params.id).select('id')
  if (del.error) {
    if (del.error.message.includes('cannot be deleted')) return reply.code(409).send({ error: 'team_delete_blocked', correlationId: request.id })
    throw del.error
  }
  if (del.data.length === 0) return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
  const audit = await supabaseClients.forService().from('audit_events').insert({
    organization_id: existing.data.organization_id,
    actor_user_id: request.auth!.userId,
    action: 'team.deleted',
    entity_type: 'teams',
    entity_id: params.id,
    correlation_id: request.id,
  })
  if (audit.error) request.log.error({ err: audit.error, correlationId: request.id }, 'audit_events insert failed')
  return reply.code(204).send()
})

}
