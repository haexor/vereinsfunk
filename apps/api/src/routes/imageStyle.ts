import {
  ApplyImageStyleRenderRequestSchema,
  ApplyImageStyleRenderResponseSchema,
  CreateImageStylePresetRequestSchema,
  ImageStylePresetSchema,
  UpdateImageStylePresetRequestSchema,
  UuidSchema,
} from '@vereinsfunk/contracts'
import { isBrandAssetSelectable, resolveBrand, type BrandLevelProfile, type BrandOverrideProfile } from '@vereinsfunk/domain'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { mapBrandRow, mapDepartmentBrandRow, mapImageStylePresetRow, mapTeamBrandRow } from '../apiMappers.js'
import { hashLogoBuffer } from '../brandLogo.js'
import { renderImageStyle } from '../imageStyle.js'
import type { ApiRouteContext } from './context.js'
import { loadSelectableBrandAsset } from './brand.js'
import { createAuditRecorder, resolveDirectoryScope, toPermissionScope } from './shared.js'

// Post-Status, aus denen heraus die Route ueberhaupt noch schreiben darf -- dieselbe Grenze wie
// request_approval() sie zieht (nur draft_ready/rendering/changes_requested duerfen ueberhaupt
// zur Freigabe eingereicht werden, 2026081702): alles davor ist ebenfalls unbedenklich editierbar,
// alles ab awaiting_approval nicht mehr. apply_image_style_render (Migration 2026081915) prueft
// dieselbe Menge serverseitig noch einmal als Verteidigung gegen einen Race.
const EDITABLE_POST_STATUSES = new Set(['draft', 'facts_required', 'generating', 'draft_ready', 'render_queued', 'rendering', 'changes_requested'])

async function downloadBrandAssetBuffer(service: SupabaseClient, organizationId: string, assetId: string): Promise<Buffer> {
  const asset = await service.from('brand_assets').select('object_path').eq('id', assetId).eq('organization_id', organizationId).eq('status', 'ready').maybeSingle()
  if (asset.error) throw asset.error
  if (!asset.data) throw new Error('brand_asset_not_ready')
  const download = await service.storage.from('brand-assets').download(asset.data.object_path as string)
  if (download.error) throw download.error
  return Buffer.from(await download.data.arrayBuffer())
}

// packages/domain exportiert OrganizationBrandLevel/DepartmentBrandLevel bewusst nicht ueber den
// oeffentlichen Index (nur die Basisprofile BrandLevelProfile/BrandOverrideProfile) -- hier lokal
// nachgebildet statt den internen Modulpfad zu importieren.
type OrganizationBrandLevelInput = BrandLevelProfile & { allowDepartmentOverrides: boolean; lockedFields: readonly string[] }
type DepartmentBrandLevelInput = BrandOverrideProfile & { allowTeamOverrides: boolean; lockedFields: readonly string[] }

// Die fuer den parametrischen Rahmen und den Duoton-Filter tatsaechlich wirksame Vereinsfarbe --
// dieselbe Vererbungskette (Verein -> Abteilung -> Mannschaft) wie packages/domain's resolveBrand
// sie fuer die Marke-Seite schon aufloest, hier fuer die Zielebene des Beitrags statt fuer eine
// gerade aktive UI-Ebene.
async function loadResolvedBrandColors(
  service: SupabaseClient, organizationId: string, departmentId: string | null, teamId: string | null,
): Promise<{ primaryColor: string; accentColor: string }> {
  const [orgRow, deptRow, teamRow] = await Promise.all([
    service.from('organization_brand_profiles').select().eq('organization_id', organizationId).maybeSingle(),
    departmentId ? service.from('department_brand_profiles').select().eq('organization_id', organizationId).eq('department_id', departmentId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    teamId ? service.from('team_brand_profiles').select().eq('organization_id', organizationId).eq('team_id', teamId).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ])
  if (orgRow.error) throw orgRow.error
  if (deptRow.error) throw deptRow.error
  if (teamRow.error) throw teamRow.error

  const organization: OrganizationBrandLevelInput = orgRow.data
    ? {
        ...(mapBrandRow(orgRow.data) as unknown as BrandLevelProfile),
        allowDepartmentOverrides: orgRow.data.allow_department_overrides as boolean,
        lockedFields: (orgRow.data.locked_fields as string[]) ?? [],
      }
    : { allowDepartmentOverrides: true, lockedFields: [] }
  const department: DepartmentBrandLevelInput | null = deptRow.data
    ? {
        ...(mapDepartmentBrandRow(deptRow.data) as unknown as BrandOverrideProfile),
        allowTeamOverrides: deptRow.data.allow_team_overrides as boolean,
        lockedFields: (deptRow.data.locked_fields as string[]) ?? [],
      }
    : null
  const team = teamRow.data ? (mapTeamBrandRow(teamRow.data) as unknown as BrandOverrideProfile) : null

  const resolved = resolveBrand(organization, department, team)
  return { primaryColor: resolved.primaryColor, accentColor: resolved.accentColor }
}

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

  // Plan 045, PR 2: rendert ein Preset auf das an post_media haengende Foto und ersetzt dessen
  // Derivat-Zeiger durch das neue, unveraenderliche Ergebnis. Autorisierung laeuft ueber den
  // Post: post_media -> post_versions -> posts liefert department_id/team_id/status, geprueft
  // gegen 'post.edit' (nicht 'brand.manage' -- das Anwenden eines Presets ist eine Beitrags-, keine
  // Marken-Aktion). Die eigentliche Sharp-/Storage-Arbeit laeuft mit Service Role, danach schreibt
  // apply_image_style_render (Migration 2026081915) Derivat + post_media-Zeiger atomar.
  app.post('/v1/post-media/:postMediaId/style-render', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ postMediaId: UuidSchema }).parse(request.params)
    const input = ApplyImageStyleRenderRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)

    const media = await client.from('post_media').select('id, organization_id, post_version_id, media_derivative_id').eq('id', params.postMediaId).maybeSingle()
    if (media.error) throw media.error
    if (!media.data) return reply.code(404).send({ error: 'post_media_not_found', correlationId: request.id })
    const organizationId = media.data.organization_id as string

    const version = await client.from('post_versions').select('post_id').eq('id', media.data.post_version_id).eq('organization_id', organizationId).maybeSingle()
    if (version.error) throw version.error
    if (!version.data) return reply.code(404).send({ error: 'post_media_not_found', correlationId: request.id })

    const post = await client.from('posts').select('department_id, team_id, status').eq('id', version.data.post_id).eq('organization_id', organizationId).maybeSingle()
    if (post.error) throw post.error
    if (!post.data) return reply.code(404).send({ error: 'post_media_not_found', correlationId: request.id })

    const scope = toPermissionScope(organizationId, post.data.department_id as string | null, post.data.team_id as string | null)
    if (!(await requirePermission(request, reply, 'post.edit', scope))) return

    if (!EDITABLE_POST_STATUSES.has(post.data.status as string)) {
      return reply.code(409).send({ error: 'post_not_editable', correlationId: request.id })
    }

    const presetRow = await client.from('image_style_presets').select().eq('id', input.stylePresetId).eq('organization_id', organizationId).maybeSingle()
    if (presetRow.error) throw presetRow.error
    if (!presetRow.data) return reply.code(404).send({ error: 'image_style_preset_not_found', correlationId: request.id })
    const preset = ImageStylePresetSchema.parse(mapImageStylePresetRow(presetRow.data))
    if (!preset.isActive) return reply.code(400).send({ error: 'image_style_preset_not_active', correlationId: request.id })
    const targetScope = scope.teamId ? 'team' : scope.departmentId ? 'department' : 'organization'
    const presetSelectable = isBrandAssetSelectable(
      {
        scope: preset.teamId ? 'team' : preset.departmentId ? 'department' : 'organization',
        ...(preset.departmentId ? { departmentId: preset.departmentId } : {}),
        ...(preset.teamId ? { teamId: preset.teamId } : {}),
      },
      targetScope, scope.departmentId, scope.teamId,
    )
    if (!presetSelectable) return reply.code(400).send({ error: 'image_style_preset_not_selectable', correlationId: request.id })

    const currentDerivative = await client.from('media_derivatives').select('media_asset_id').eq('id', media.data.media_derivative_id).eq('organization_id', organizationId).maybeSingle()
    if (currentDerivative.error) throw currentDerivative.error
    if (!currentDerivative.data) return reply.code(404).send({ error: 'post_media_not_found', correlationId: request.id })
    const sourceMediaAssetId = currentDerivative.data.media_asset_id as string

    const service = supabaseClients.forService()
    const sourceAsset = await service.from('media_assets').select('bucket_id, object_path, sha256').eq('id', sourceMediaAssetId).eq('organization_id', organizationId).maybeSingle()
    if (sourceAsset.error) throw sourceAsset.error
    if (!sourceAsset.data) return reply.code(404).send({ error: 'source_media_asset_not_found', correlationId: request.id })
    const download = await service.storage.from(sourceAsset.data.bucket_id as string).download(sourceAsset.data.object_path as string)
    if (download.error) throw download.error
    const sourceBuffer = Buffer.from(await download.data.arrayBuffer())

    const [frameAssetBuffer, logoAssetBuffer, brandColors] = await Promise.all([
      preset.frameType === 'custom' && preset.frameBrandAssetId ? downloadBrandAssetBuffer(service, organizationId, preset.frameBrandAssetId) : Promise.resolve(undefined),
      preset.logoEnabled && preset.logoBrandAssetId ? downloadBrandAssetBuffer(service, organizationId, preset.logoBrandAssetId) : Promise.resolve(undefined),
      loadResolvedBrandColors(service, organizationId, scope.departmentId ?? null, scope.teamId ?? null),
    ])

    const rendered = await renderImageStyle({
      sourceBuffer, preset, brandColors,
      ...(frameAssetBuffer ? { frameAssetBuffer } : {}),
      ...(logoAssetBuffer ? { logoAssetBuffer } : {}),
    })
    const outputSha256 = hashLogoBuffer(rendered.buffer)
    const extension = rendered.contentType === 'image/jpeg' ? 'jpg' : rendered.contentType === 'image/webp' ? 'webp' : 'png'
    const objectPath = `organizations/${organizationId}/derivatives/${sourceMediaAssetId}/styled-${preset.id}-${outputSha256}.${extension}`

    const upload = await service.storage.from('rendered-media').upload(objectPath, rendered.buffer, { contentType: rendered.contentType, upsert: true })
    if (upload.error) throw upload.error

    const stylePresetSnapshot = {
      name: preset.name, frameType: preset.frameType, frameColor: preset.frameColor, frameWidthPx: preset.frameWidthPx,
      frameCornerRadiusPx: preset.frameCornerRadiusPx, frameBrandAssetId: preset.frameBrandAssetId,
      logoEnabled: preset.logoEnabled, logoBrandAssetId: preset.logoBrandAssetId, logoPosition: preset.logoPosition,
      logoSizePercent: preset.logoSizePercent, logoMarginPercent: preset.logoMarginPercent, filter: preset.filter,
    }
    const recipe = {
      kind: 'image_style_v1', stylePresetId: preset.id, stylePresetSnapshot,
      sourceMediaAssetId, sourceSha256: sourceAsset.data.sha256 as string,
    }

    const applied = await service.rpc('apply_image_style_render', {
      p_post_media_id: params.postMediaId,
      p_actor_user_id: request.auth!.userId,
      p_style_preset_id: preset.id,
      p_media_asset_id: sourceMediaAssetId,
      p_object_path: objectPath,
      p_sha256: outputSha256,
      p_mime_type: rendered.contentType,
      p_byte_size: rendered.buffer.length,
      p_width: rendered.width,
      p_height: rendered.height,
      p_recipe: recipe,
    })
    if (applied.error) throw applied.error

    const signed = await service.storage.from('rendered-media').createSignedUrl(objectPath, 600)
    if (signed.error) throw signed.error

    return reply.code(201).send(ApplyImageStyleRenderResponseSchema.parse({ mediaDerivativeId: applied.data, objectPath, signedUrl: signed.data.signedUrl }))
  })
}
