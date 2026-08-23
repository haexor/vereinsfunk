import {
  ContentSignatureBlockSchema,
  CreateContentSignatureBlockRequestSchema,
  UpdateContentSignatureBlockRequestSchema,
  UuidSchema,
} from '@vereinsfunk/contracts'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { mapContentSignatureBlockRow } from '../apiMappers.js'
import type { ApiRouteContext } from './context.js'
import { createAuditRecorder, resolveDirectoryScope, toPermissionScope } from './shared.js'

// Paket B, PR 0: CRUD fuer frei anlegbare Textbausteine (CTA/Footer/Signatur), analog
// apps/api/src/routes/imageStyle.ts -- GET ohne eigenes Berechtigungsgate (RLS entscheidet die
// Sichtbarkeit), POST/PATCH/DELETE ueber den Nutzer-Client mit post.create auf der Zielebene
// (siehe Migration 2026082302 fuer die spiegelbildlichen RLS-Policies).
export function registerContentSignatureBlockRoutes(app: FastifyInstance, context: ApiRouteContext): void {
  const { requireAuth, requirePermission, supabaseClients } = context
  const recordAuditEvent = createAuditRecorder(supabaseClients)

  app.get('/v1/content-signature-blocks', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const query = z.object({ organizationId: UuidSchema }).parse(request.query)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const rows = await client.from('content_signature_blocks').select().eq('organization_id', query.organizationId).order('created_at', { ascending: false })
    if (rows.error) throw rows.error
    return reply.send({ blocks: rows.data.map((row) => ContentSignatureBlockSchema.parse(mapContentSignatureBlockRow(row))) })
  })

  app.post('/v1/content-signature-blocks', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const input = CreateContentSignatureBlockRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    // departmentId gegen seine echte organization_id verifizieren, BEVOR die Berechtigung geprueft
    // wird -- sonst waere sie client-seitig frei kombinierbar (dieselbe Reihenfolge wie
    // POST /v1/image-style-presets).
    const resolvedScope = await resolveDirectoryScope(client, input.organizationId, input.departmentId ?? null, null)
    if (resolvedScope === null) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, 'post.create', resolvedScope))) return

    const insert = await client
      .from('content_signature_blocks')
      .insert({
        organization_id: input.organizationId,
        department_id: input.departmentId ?? null,
        name: input.name,
        body: input.body,
        created_by: request.auth!.userId,
      })
      .select()
      .single()
    if (insert.error) throw insert.error
    await recordAuditEvent(request, {
      organizationId: input.organizationId,
      action: 'content_signature_block.created',
      entityType: 'content_signature_block',
      entityId: insert.data.id as string,
      metadata: { scope: input.departmentId ? 'department' : 'organization' },
    })
    return reply.code(201).send(ContentSignatureBlockSchema.parse(mapContentSignatureBlockRow(insert.data)))
  })

  // Scope ist unveraendlich und wird aus der bestehenden Zeile hergeleitet, nicht aus dem Body
  // uebernommen (plans/README.md, "RPC traut Client nicht") -- ueber den Nutzer-eigenen Client
  // gelesen, damit content_signature_blocks_select bereits greift: eine Zeile ausserhalb des
  // eigenen Scopes liefert so "nicht gefunden" statt vorab per Service Role Existenz zu verraten.
  app.patch('/v1/content-signature-blocks/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = UpdateContentSignatureBlockRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const existing = await client.from('content_signature_blocks').select('organization_id, department_id').eq('id', params.id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return reply.code(404).send({ error: 'content_signature_block_not_found', correlationId: request.id })
    const scope = toPermissionScope(existing.data.organization_id as string, existing.data.department_id as string | null)
    if (!(await requirePermission(request, reply, 'post.create', scope))) return

    const payload: Record<string, unknown> = { name: input.name, body: input.body }
    if (input.isActive !== undefined) payload.is_active = input.isActive
    const update = await client.from('content_signature_blocks').update(payload).eq('id', params.id).select().maybeSingle()
    if (update.error) throw update.error
    if (!update.data) return reply.code(404).send({ error: 'content_signature_block_not_found', correlationId: request.id })
    await recordAuditEvent(request, {
      organizationId: existing.data.organization_id as string,
      action: 'content_signature_block.updated',
      entityType: 'content_signature_block',
      entityId: params.id,
      metadata: {},
    })
    return reply.code(200).send(ContentSignatureBlockSchema.parse(mapContentSignatureBlockRow(update.data)))
  })

  app.delete('/v1/content-signature-blocks/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const existing = await client.from('content_signature_blocks').select('organization_id, department_id').eq('id', params.id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return reply.code(404).send({ error: 'content_signature_block_not_found', correlationId: request.id })
    const scope = toPermissionScope(existing.data.organization_id as string, existing.data.department_id as string | null)
    if (!(await requirePermission(request, reply, 'post.create', scope))) return
    // Zwischen dem Lookup und dem DELETE kann eine andere berechtigte Anfrage die Zeile entfernt
    // haben. Supabase meldet das nicht als Fehler; deshalb die exakte Anzahl pruefen und nur eine
    // tatsaechlich geloeschte Zeile auditieren.
    const del = await client.from('content_signature_blocks').delete({ count: 'exact' }).eq('id', params.id)
    if (del.error) throw del.error
    if (del.count !== 1) return reply.code(404).send({ error: 'content_signature_block_not_found', correlationId: request.id })
    await recordAuditEvent(request, {
      organizationId: existing.data.organization_id as string,
      action: 'content_signature_block.deleted',
      entityType: 'content_signature_block',
      entityId: params.id,
      metadata: {},
    })
    return reply.code(204).send()
  })
}
