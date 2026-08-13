import {
  CreatePlatformStylePersonaRequestSchema,
  PlatformStylePersonaSchema,
  PreviewPlatformStylePersonaRequestSchema,
  UpdatePlatformStylePersonaRequestSchema,
  UuidSchema,
} from '@vereinsfunk/contracts'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ApiRouteContext } from './context.js'
import { checkRateLimit, previewStyleProfile, resolvePreviewIdempotencyKey } from './shared.js'

const PERSONA_COLUMNS = 'id, slug, name, description, style_rules, avoid_rules, do_rules, is_active, created_by, created_at, updated_at'

function mapPersonaRow(row: Record<string, unknown>) {
  return {
    id: row.id, slug: row.slug, name: row.name, description: row.description,
    styleRules: row.style_rules, avoidRules: row.avoid_rules, doRules: row.do_rules, isActive: row.is_active,
    createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

// Plan 037: platform-admin-curated, global persona catalogue for the text workshop -- no
// organization_id, referenced only by slug (see platform_style_personas migration). CRUD 1:1
// nach dem Muster von llmProviders.routes.ts. Wie dort erzeugt diese Route bewusst keinen
// audit_events-Eintrag: die gesamte Plattform-Administration hat bislang keinen eigenen
// Audit-Trail, ein auf Personas beschraenkter Sonderweg waere selbst unvollstaendig.
export function registerPlatformPersonaRoutes(app: FastifyInstance, context: ApiRouteContext): void {
  const { environment, requireAuth, requirePlatformAdmin, supabaseClients, textGenerator } = context

  app.get('/v1/platform-style-personas', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    if (!(await requirePlatformAdmin(request, reply))) return
    const service = supabaseClients.forService()
    const rows = await service.from('platform_style_personas').select(PERSONA_COLUMNS).order('name')
    if (rows.error) throw rows.error
    return reply.code(200).send(rows.data.map((row) => PlatformStylePersonaSchema.parse(mapPersonaRow(row))))
  })

  app.post('/v1/platform-style-personas', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    if (!(await requirePlatformAdmin(request, reply))) return
    const input = CreatePlatformStylePersonaRequestSchema.parse(request.body)
    const service = supabaseClients.forService()
    const insert = await service
      .from('platform_style_personas')
      .insert({
        slug: input.slug, name: input.name, description: input.description,
        style_rules: input.styleRules, avoid_rules: input.avoidRules, do_rules: input.doRules, created_by: request.auth!.userId,
      })
      .select(PERSONA_COLUMNS)
      .single()
    if (insert.error) throw insert.error
    return reply.code(201).send(PlatformStylePersonaSchema.parse(mapPersonaRow(insert.data)))
  })

  app.patch('/v1/platform-style-personas/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    if (!(await requirePlatformAdmin(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = UpdatePlatformStylePersonaRequestSchema.parse(request.body)
    const service = supabaseClients.forService()
    const payload: Record<string, unknown> = {}
    if (input.slug !== undefined) payload.slug = input.slug
    if (input.name !== undefined) payload.name = input.name
    if (input.description !== undefined) payload.description = input.description
    if (input.styleRules !== undefined) payload.style_rules = input.styleRules
    if (input.avoidRules !== undefined) payload.avoid_rules = input.avoidRules
    if (input.doRules !== undefined) payload.do_rules = input.doRules
    if (input.isActive !== undefined) payload.is_active = input.isActive
    const update = await service.from('platform_style_personas').update(payload).eq('id', params.id).select(PERSONA_COLUMNS).maybeSingle()
    if (update.error) throw update.error
    if (!update.data) return reply.code(404).send({ error: 'platform_style_persona_not_found' })
    return reply.code(200).send(PlatformStylePersonaSchema.parse(mapPersonaRow(update.data)))
  })

  app.delete('/v1/platform-style-personas/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    if (!(await requirePlatformAdmin(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const service = supabaseClients.forService()
    const del = await service.from('platform_style_personas').delete().eq('id', params.id)
    if (del.error) throw del.error
    return reply.code(204).send()
  })

  // "Persona testen": calls the active text provider directly and synchronously, no
  // session/candidate row (see previewStyleProfile, routes/shared.ts).
  app.post('/v1/platform-style-personas/preview', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    if (!(await requirePlatformAdmin(request, reply))) return
    // Dasselbe Kostenlimit wie auf der Vereinsseite (routes/content.ts): auch ein Plattform-Admin
    // soll den Provider nicht in einer Schleife abrufen koennen, absichtlich oder versehentlich.
    if (!checkRateLimit(`style-preview:${request.auth!.userId}`, 10, 60_000)) {
      return reply.code(429).send({ error: 'rate_limited', correlationId: request.id })
    }
    const input = PreviewPlatformStylePersonaRequestSchema.parse(request.body)
    // A retried request (client-side timeout, double-click) must not bill the provider twice --
    // resolvePreviewIdempotencyKey/previewStyleProfile share one in-flight call per key (shared.ts).
    const idempotencyKey = resolvePreviewIdempotencyKey(request)
    if (idempotencyKey === null) return reply.code(400).send({ error: 'invalid_idempotency_key', correlationId: request.id })
    const result = await previewStyleProfile(supabaseClients, environment, input, idempotencyKey, textGenerator)
    if (!result.ok) return reply.code(result.status).send({ error: result.error, correlationId: request.id })
    return reply.code(200).send(result.post)
  })
}
