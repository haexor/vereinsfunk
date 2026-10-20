import { CreateCustomStyleProfileRequestSchema, CustomStyleProfileSchema, PreviewCustomStyleProfileRequestSchema, StyleProfileRulesSchema, UpdateCustomStyleProfileRequestSchema, UuidSchema } from '@vereinsfunk/contracts'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { isStyleProfileUsableInScope, SYSTEM_STYLE_PROFILES } from '../services/textGenerationSessions.js'
import type { ApiRouteContext } from './context.js'
import { checkRateLimit, createAuditRecorder } from './shared.js'
import { buildStyleProfilePromptPreview, previewStyleProfile, resolvePreviewIdempotencyKey } from '../services/styleProfilePreview.js'
import { resolveDirectoryScope, scopeLevelOf, toPermissionScope } from '../services/scopeAuthorization.js'
import { TextWorkshopScopeSchema } from './textWorkshop.js'

const CUSTOM_STYLE_PROFILE_COLUMNS = 'id, organization_id, department_id, team_id, slug, name, description, style_rules, avoid_rules, do_rules, is_active, created_by, created_at, updated_at'

function mapCustomStyleProfileRow(row: Record<string, unknown>) {
  return {
    id: row.id, organizationId: row.organization_id, departmentId: row.department_id, teamId: row.team_id,
    slug: row.slug, kind: 'custom' as const, name: row.name, description: row.description,
    styleRules: StyleProfileRulesSchema.parse(row.style_rules), avoidRules: row.avoid_rules, doRules: row.do_rules,
    isActive: row.is_active, createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

export function registerContentStyleProfileRoutes(app: FastifyInstance, context: ApiRouteContext): void {
  const { environment, requireAuth, requirePermission, supabaseClients, textGenerator } = context
  const recordAuditEvent = createAuditRecorder(supabaseClients)

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

  app.post('/v1/content-style-profiles', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const input = CreateCustomStyleProfileRequestSchema.parse(request.body)
    if (!(await requirePermission(request, reply, 'post.create', toPermissionScope(input.organizationId, input.departmentId ?? null, input.teamId ?? null)))) return
    const service = supabaseClients.forService()
    const inserted = await service.from('content_style_profiles').insert({ organization_id: input.organizationId, department_id: input.departmentId ?? null, team_id: input.teamId ?? null, slug: input.slug, name: input.name, kind: 'custom', description: input.description, style_rules: input.styleRules, avoid_rules: input.avoidRules, do_rules: input.doRules, created_by: request.auth!.userId }).select('id').single()
    if (inserted.error) throw inserted.error
    await recordAuditEvent(request, { organizationId: input.organizationId, action: 'content_style_profile.created', entityType: 'content_style_profile', entityId: inserted.data.id as string, metadata: { scope: scopeLevelOf(input) } })
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
    await recordAuditEvent(request, { organizationId: existing.data.organization_id, action: 'content_style_profile.deleted', entityType: 'content_style_profile', entityId: params.id, metadata: { scope: scopeLevelOf({ departmentId: existing.data.department_id, teamId: existing.data.team_id }) } })
    return reply.code(204).send()
  })

  // "Stilprofil testen": calls the active text provider directly and synchronously, no
  // session/candidate row (see previewStyleProfile, services/styleProfilePreview.ts). Scope-gated like POST
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
  // (services/styleProfilePreview.ts). Same scope gate as /preview above (same draft data, same "may only look at
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
}
