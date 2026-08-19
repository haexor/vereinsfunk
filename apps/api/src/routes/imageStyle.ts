import { CreateImageStylePresetRequestSchema, ImageStylePresetSchema, UpdateImageStylePresetRequestSchema, UuidSchema } from '@vereinsfunk/contracts'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { mapImageStylePresetRow } from '../apiMappers.js'
import type { ApiRouteContext } from './context.js'
import { loadSelectableBrandAsset } from './brand.js'
import { createAuditRecorder, resolveDirectoryScope, toPermissionScope } from './shared.js'

// Plan 045, PR 1: CRUD fuer Bildstil-Presets. Eigenes Modul statt in brand.ts (Modulgrenze wie
// Plan 027) -- ein Preset ist kein brand_asset, sondern referenziert bis zu zwei davon.
export function registerImageStyleRoutes(app: FastifyInstance, context: ApiRouteContext): void {
  const { requireAuth, requirePermission, supabaseClients } = context
  const recordAuditEvent = createAuditRecorder(supabaseClients)

  // Sichtbarkeit ist allein RLS' Sache (image_style_presets_select, dieselbe Abschottung wie
  // brand_assets): kein zusaetzliches Berechtigungsgate hier, sonst saehe ein Mitglied ohne
  // brand.manage die vereinsweiten/eigenen Presets seiner Abteilung nicht einmal lesend -- fuer
  // die spaetere Preset-Auswahl in erstellen.vue (Plan 045, PR 3) muss genau das gehen.
  app.get('/v1/image-style-presets', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const query = z.object({ organizationId: UuidSchema }).parse(request.query)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const rows = await client.from('image_style_presets').select().eq('organization_id', query.organizationId).order('created_at', { ascending: false })
    if (rows.error) throw rows.error
    return reply.send({ presets: rows.data.map((row) => ImageStylePresetSchema.parse(mapImageStylePresetRow(row))) })
  })

  app.post('/v1/image-style-presets', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const input = CreateImageStylePresetRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    // departmentId/teamId gegen ihre echte organization_id verifizieren, BEVOR die Berechtigung
    // geprueft wird -- sonst waeren sie client-seitig frei kombinierbar (dieselbe Reihenfolge wie
    // /v1/text-generation-platforms, routes/content.ts).
    const resolvedScope = await resolveDirectoryScope(client, input.organizationId, input.departmentId ?? null, input.teamId ?? null)
    if (resolvedScope === null) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, 'brand.manage', resolvedScope))) return

    for (const [assetId, expectedKind] of [
      [input.frameBrandAssetId, 'frame'],
      [input.logoBrandAssetId, 'watermark'],
    ] as const) {
      if (!assetId) continue
      const targetScope = resolvedScope.teamId ? 'team' : resolvedScope.departmentId ? 'department' : 'organization'
      const asset = await loadSelectableBrandAsset(client, input.organizationId, assetId, targetScope, resolvedScope.departmentId, resolvedScope.teamId)
      if (!asset || asset.kind !== expectedKind) return reply.code(400).send({ error: 'invalid_asset_reference', correlationId: request.id })
    }

    const insert = await client
      .from('image_style_presets')
      .insert({
        organization_id: input.organizationId,
        department_id: input.departmentId ?? null,
        team_id: input.teamId ?? null,
        name: input.name,
        frame_type: input.frameType,
        frame_color: input.frameColor,
        frame_width_px: input.frameWidthPx,
        frame_corner_radius_px: input.frameCornerRadiusPx,
        frame_brand_asset_id: input.frameBrandAssetId,
        logo_enabled: input.logoEnabled,
        logo_brand_asset_id: input.logoBrandAssetId,
        logo_position: input.logoPosition,
        logo_size_percent: input.logoSizePercent,
        logo_margin_percent: input.logoMarginPercent,
        filter: input.filter,
        created_by: request.auth!.userId,
      })
      .select()
      .single()
    if (insert.error) throw insert.error
    await recordAuditEvent(request, {
      organizationId: input.organizationId,
      action: 'image_style_preset.created',
      entityType: 'image_style_preset',
      entityId: insert.data.id as string,
      metadata: { scope: input.teamId ? 'team' : input.departmentId ? 'department' : 'organization' },
    })
    return reply.code(201).send(ImageStylePresetSchema.parse(mapImageStylePresetRow(insert.data)))
  })

  // Scope ist unveraendlich und wird aus der bestehenden Zeile hergeleitet, nicht aus dem Body
  // uebernommen (plans/README.md, "RPC traut Client nicht") -- ueber den Nutzer-eigenen Client
  // gelesen, damit image_style_presets_select bereits greift: eine Zeile ausserhalb des eigenen
  // Scopes liefert so "nicht gefunden" statt vorab per Service Role Existenz/Scope zu verraten.
  app.patch('/v1/image-style-presets/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const existing = await client.from('image_style_presets').select('organization_id, department_id, team_id').eq('id', params.id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return reply.code(404).send({ error: 'image_style_preset_not_found', correlationId: request.id })
    const scope = toPermissionScope(existing.data.organization_id as string, existing.data.department_id as string | null, existing.data.team_id as string | null)
    if (!(await requirePermission(request, reply, 'brand.manage', scope))) return
    const input = UpdateImageStylePresetRequestSchema.parse(request.body)

    for (const [assetId, expectedKind] of [
      [input.frameBrandAssetId, 'frame'],
      [input.logoBrandAssetId, 'watermark'],
    ] as const) {
      if (!assetId) continue
      const targetScope = scope.teamId ? 'team' : scope.departmentId ? 'department' : 'organization'
      const asset = await loadSelectableBrandAsset(client, scope.organizationId, assetId, targetScope, scope.departmentId, scope.teamId)
      if (!asset || asset.kind !== expectedKind) return reply.code(400).send({ error: 'invalid_asset_reference', correlationId: request.id })
    }

    const payload: Record<string, unknown> = {
      name: input.name,
      frame_type: input.frameType,
      frame_color: input.frameColor,
      frame_width_px: input.frameWidthPx,
      frame_corner_radius_px: input.frameCornerRadiusPx,
      frame_brand_asset_id: input.frameBrandAssetId,
      logo_enabled: input.logoEnabled,
      logo_brand_asset_id: input.logoBrandAssetId,
      logo_position: input.logoPosition,
      logo_size_percent: input.logoSizePercent,
      logo_margin_percent: input.logoMarginPercent,
      filter: input.filter,
    }
    if (input.isActive !== undefined) payload.is_active = input.isActive
    const update = await client.from('image_style_presets').update(payload).eq('id', params.id).select().maybeSingle()
    if (update.error) throw update.error
    if (!update.data) return reply.code(404).send({ error: 'image_style_preset_not_found', correlationId: request.id })
    await recordAuditEvent(request, {
      organizationId: existing.data.organization_id as string,
      action: 'image_style_preset.updated',
      entityType: 'image_style_preset',
      entityId: params.id,
      metadata: {},
    })
    return reply.code(200).send(ImageStylePresetSchema.parse(mapImageStylePresetRow(update.data)))
  })

  app.delete('/v1/image-style-presets/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const existing = await client.from('image_style_presets').select('organization_id, department_id, team_id').eq('id', params.id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return reply.code(404).send({ error: 'image_style_preset_not_found', correlationId: request.id })
    const scope = toPermissionScope(existing.data.organization_id as string, existing.data.department_id as string | null, existing.data.team_id as string | null)
    if (!(await requirePermission(request, reply, 'brand.manage', scope))) return
    const del = await client.from('image_style_presets').delete().eq('id', params.id)
    if (del.error) throw del.error
    await recordAuditEvent(request, {
      organizationId: existing.data.organization_id as string,
      action: 'image_style_preset.deleted',
      entityType: 'image_style_preset',
      entityId: params.id,
      metadata: {},
    })
    return reply.code(204).send()
  })
}
