import {
  CreatePhotoLayoutPresetRequestSchema,
  PHOTO_LAYOUT_PHOTO_COUNTS,
  PhotoLayoutPresetSchema,
  RenderPhotoLayoutRequestSchema,
  RenderPhotoLayoutResponseSchema,
  UpdatePhotoLayoutPresetRequestSchema,
  UuidSchema,
} from '@vereinsfunk/contracts'
import { isBrandAssetSelectable } from '@vereinsfunk/domain'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { mapPhotoLayoutPresetRow } from '../apiMappers.js'
import { hashLogoBuffer } from '@vereinsfunk/brand-assets'
import { computeTilePlacements, PHOTO_LAYOUT_CANVAS_SIZE_PX, renderPhotoLayout, transformFaceRegionsForTile, type SourceFaceRegion } from '../photoLayout.js'
import type { ApiRouteContext } from './context.js'
import { loadResolvedBrandColors } from './imageStyle.js'
import { resolveDirectoryScope, toPermissionScope } from './shared.js'

function parseSupabaseData<T>(schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data)
  if (parsed.success) return parsed.data
  const error = new Error('Unexpected Supabase response')
  error.name = 'SupabaseResponseError'
  throw error
}

// Dieselbe Pruefung wie der mediaAssetIds-Loop in POST /v1/text-workshop/sessions
// (routes/content.ts) -- absichtlich wortgleiche Fehlercodes, weil erstellen.vue deren
// Fehlerbehandlung (media_asset_not_reviewed/not_ready/not_found) fuer diese Route mitbenutzt.
const RenderMediaAssetRowSchema = z.object({
  organization_id: UuidSchema, department_id: UuidSchema, upload_status: z.string(), people_reviewed_at: z.string().nullable(),
  bucket_id: z.string().min(1), object_path: z.string().min(1), mime_type: z.string().min(1),
  width: z.int().positive().nullable(), height: z.int().positive().nullable(),
})
const FaceRegionRowSchema = z.object({
  x: z.number(), y: z.number(), width: z.number(), height: z.number(),
  source: z.enum(['automatic', 'manual']), confidence: z.number().nullable(),
  subject_kind: z.enum(['adult', 'minor', 'unknown']), decision: z.string(),
  consent_record_id: UuidSchema.nullable(), obscuring_style: z.string().nullable(),
})
const PresetScopeRowSchema = z.object({
  organization_id: UuidSchema, department_id: UuidSchema.nullable(), team_id: UuidSchema.nullable(),
})

async function loadSourcePhoto(
  service: SupabaseClient, organizationId: string, departmentId: string, mediaAssetId: string,
): Promise<{ buffer: Buffer; width: number; height: number; faceRegions: SourceFaceRegion[] } | { error: string }> {
  const asset = await service.from('media_assets').select('organization_id, department_id, upload_status, people_reviewed_at, bucket_id, object_path, mime_type, width, height').eq('id', mediaAssetId).maybeSingle()
  if (asset.error) throw asset.error
  const parsed = asset.data === null ? null : parseSupabaseData(RenderMediaAssetRowSchema, asset.data)
  if (!parsed || parsed.organization_id !== organizationId || parsed.department_id !== departmentId) return { error: 'media_asset_not_found' }
  if (parsed.upload_status !== 'ready') return { error: 'media_asset_not_ready' }
  if (parsed.people_reviewed_at === null) return { error: 'media_asset_not_reviewed' }
  if (!parsed.mime_type.startsWith('image/')) return { error: 'media_asset_not_an_image' }
  if (parsed.width === null || parsed.height === null) return { error: 'media_asset_missing_dimensions' }

  const [download, faceRegions] = await Promise.all([
    service.storage.from(parsed.bucket_id).download(parsed.object_path),
    service.from('face_regions').select('x, y, width, height, source, confidence, subject_kind, decision, consent_record_id, obscuring_style').eq('media_asset_id', mediaAssetId),
  ])
  if (download.error) throw download.error
  if (faceRegions.error) throw faceRegions.error
  const buffer = Buffer.from(await download.data.arrayBuffer())
  const regions = z.array(FaceRegionRowSchema).parse(faceRegions.data).map((row) => ({
    x: row.x, y: row.y, width: row.width, height: row.height, source: row.source, confidence: row.confidence,
    subjectKind: row.subject_kind, decision: row.decision, consentRecordId: row.consent_record_id, obscuringStyle: row.obscuring_style,
  }))
  return { buffer, width: parsed.width, height: parsed.height, faceRegions: regions }
}

// Plan 047, PR 1: "Bildkomposition" -- CRUD fuer Layout-Presets nach demselben Muster wie
// registerImageStyleRoutes (routes/imageStyle.ts), plus die eigentliche Render-Route.
export function registerPhotoLayoutRoutes(app: FastifyInstance, context: ApiRouteContext): void {
  const { requireAuth, requirePermission, supabaseClients } = context

  // Sichtbarkeit ist RLS' Sache (photo_layout_presets_select) -- kein zusaetzliches
  // Berechtigungsgate, aus demselben Grund wie GET /v1/image-style-presets.
  app.get('/v1/photo-layout-presets', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const query = z.object({ organizationId: UuidSchema }).parse(request.query)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const rows = await client.from('photo_layout_presets').select().eq('organization_id', query.organizationId).order('created_at', { ascending: false })
    if (rows.error) throw rows.error
    return reply.send({ presets: rows.data.map((row) => PhotoLayoutPresetSchema.parse(mapPhotoLayoutPresetRow(row))) })
  })

  app.post('/v1/photo-layout-presets', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const input = CreatePhotoLayoutPresetRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const resolvedScope = await resolveDirectoryScope(client, input.organizationId, input.departmentId ?? null, input.teamId ?? null)
    if (resolvedScope === null) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, 'brand.manage', resolvedScope))) return

    const insert = await client
      .from('photo_layout_presets')
      .insert({
        organization_id: input.organizationId, department_id: input.departmentId ?? null, team_id: input.teamId ?? null,
        name: input.name, kind: input.kind, divider_color: input.dividerColor, divider_width_px: input.dividerWidthPx,
        corner_radius_px: input.cornerRadiusPx, created_by: request.auth!.userId,
      })
      .select()
      .single()
    if (insert.error) throw insert.error
    return reply.code(201).send(PhotoLayoutPresetSchema.parse(mapPhotoLayoutPresetRow(insert.data)))
  })

  app.patch('/v1/photo-layout-presets/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const existing = await client.from('photo_layout_presets').select('organization_id, department_id, team_id').eq('id', params.id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return reply.code(404).send({ error: 'photo_layout_preset_not_found', correlationId: request.id })
    const existingScope = parseSupabaseData(PresetScopeRowSchema, existing.data)
    const scope = toPermissionScope(existingScope.organization_id, existingScope.department_id, existingScope.team_id)
    if (!(await requirePermission(request, reply, 'brand.manage', scope))) return
    const input = UpdatePhotoLayoutPresetRequestSchema.parse(request.body)

    const payload: Record<string, unknown> = {
      name: input.name, kind: input.kind, divider_color: input.dividerColor, divider_width_px: input.dividerWidthPx, corner_radius_px: input.cornerRadiusPx,
    }
    if (input.isActive !== undefined) payload.is_active = input.isActive
    const update = await client.from('photo_layout_presets').update(payload).eq('id', params.id).select().maybeSingle()
    if (update.error) throw update.error
    if (!update.data) return reply.code(404).send({ error: 'photo_layout_preset_not_found', correlationId: request.id })
    return reply.code(200).send(PhotoLayoutPresetSchema.parse(mapPhotoLayoutPresetRow(update.data)))
  })

  app.delete('/v1/photo-layout-presets/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const existing = await client.from('photo_layout_presets').select('organization_id, department_id, team_id').eq('id', params.id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return reply.code(404).send({ error: 'photo_layout_preset_not_found', correlationId: request.id })
    const existingScope = parseSupabaseData(PresetScopeRowSchema, existing.data)
    const scope = toPermissionScope(existingScope.organization_id, existingScope.department_id, existingScope.team_id)
    if (!(await requirePermission(request, reply, 'brand.manage', scope))) return
    const del = await client.from('photo_layout_presets').delete().eq('id', params.id)
    if (del.error) throw del.error
    return reply.code(204).send()
  })

  // Anders als POST /v1/post-media/:id/style-render gibt es hier noch keinen Beitrag/keine
  // post_media-Zeile -- die Komposition passiert in erstellen.vue, BEVOR ueberhaupt eine
  // Textwerkstatt-Sitzung angelegt wird. Die Berechtigung folgt deshalb demselben Muster wie POST
  // /v1/media/uploads bzw. POST /v1/text-workshop/sessions: 'post.create' auf Vereins-/
  // Abteilungsebene, kein Mannschafts-Scope (die Foto-Anhang-UI kennt heute keine Mannschaftsebene).
  app.post('/v1/photo-layout-presets/render', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const input = RenderPhotoLayoutRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const resolvedScope = await resolveDirectoryScope(client, input.organizationId, input.departmentId, null)
    if (resolvedScope === null) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, 'post.create', resolvedScope))) return

    const presetRow = await client.from('photo_layout_presets').select().eq('id', input.presetId).eq('organization_id', input.organizationId).maybeSingle()
    if (presetRow.error) throw presetRow.error
    if (!presetRow.data) return reply.code(404).send({ error: 'photo_layout_preset_not_found', correlationId: request.id })
    const preset = PhotoLayoutPresetSchema.parse(mapPhotoLayoutPresetRow(presetRow.data))
    if (!preset.isActive) return reply.code(400).send({ error: 'photo_layout_preset_not_active', correlationId: request.id })
    // Die Render-Route kennt nur den Abteilungs-Scope (die Foto-Anhang-UI kennt keine
    // Mannschaftsebene) -- ein mannschaftsgebundenes Preset ist von hier aus deshalb nie
    // waehlbar, auch nicht innerhalb der eigenen Abteilung (dieselbe Richtung wie
    // isBrandAssetSelectable es fuer jede andere Ebene durchsetzt).
    const presetSelectable = isBrandAssetSelectable(
      {
        scope: preset.teamId ? 'team' : preset.departmentId ? 'department' : 'organization',
        ...(preset.departmentId ? { departmentId: preset.departmentId } : {}),
        ...(preset.teamId ? { teamId: preset.teamId } : {}),
      },
      'department', input.departmentId,
    )
    if (!presetSelectable) return reply.code(400).send({ error: 'photo_layout_preset_not_selectable', correlationId: request.id })

    const photoCountRange = PHOTO_LAYOUT_PHOTO_COUNTS[preset.kind]
    if (input.mediaAssetIds.length < photoCountRange.min || input.mediaAssetIds.length > photoCountRange.max) {
      return reply.code(422).send({ error: 'photo_layout_wrong_photo_count', correlationId: request.id })
    }

    const service = supabaseClients.forService()
    const sources: { buffer: Buffer; width: number; height: number; faceRegions: SourceFaceRegion[] }[] = []
    for (const mediaAssetId of input.mediaAssetIds) {
      const source = await loadSourcePhoto(service, input.organizationId, input.departmentId, mediaAssetId)
      if ('error' in source) return reply.code(source.error === 'media_asset_not_found' ? 404 : 422).send({ error: source.error, correlationId: request.id })
      sources.push(source)
    }

    const brandColors = await loadResolvedBrandColors(service, input.organizationId, input.departmentId, null)
    const rendered = await renderPhotoLayout({ sourceBuffers: sources.map((source) => source.buffer), preset, brandColors })

    // Dieselbe Umrechnung, mit der auch gerendert wurde (computeTilePlacements) -- Sharp-Ergebnis
    // und uebertragene Gesichtsboxen muessen sich auf dieselbe Geometrie stuetzen, sonst zeigt eine
    // face_regions-Zeile auf eine Stelle, an der im Ergebnis ein ANDERES Foto liegt.
    const placements = computeTilePlacements(preset.kind, sources.length, preset.dividerWidthPx, PHOTO_LAYOUT_CANVAS_SIZE_PX)
    const transformedFaceRegions = sources.flatMap((source, index) =>
      transformFaceRegionsForTile(source.faceRegions, source.width, source.height, placements[index]!, PHOTO_LAYOUT_CANVAS_SIZE_PX),
    )

    const outputSha256 = hashLogoBuffer(rendered.buffer)
    const extension = rendered.contentType === 'image/jpeg' ? 'jpg' : 'png'
    const objectPath = `organizations/${input.organizationId}/photo-layouts/${preset.id}/${outputSha256}.${extension}`
    const upload = await service.storage.from('rendered-media').upload(objectPath, rendered.buffer, { contentType: rendered.contentType, upsert: true })
    if (upload.error) throw upload.error

    const recipe = {
      kind: 'photo_layout_v1', presetId: preset.id,
      presetSnapshot: { name: preset.name, kind: preset.kind, dividerColor: preset.dividerColor, dividerWidthPx: preset.dividerWidthPx, cornerRadiusPx: preset.cornerRadiusPx },
      sourceMediaAssetIds: input.mediaAssetIds,
    }
    const created = await service.rpc('create_photo_layout_media_asset', {
      p_organization_id: input.organizationId, p_department_id: input.departmentId, p_actor_user_id: request.auth!.userId,
      p_object_path: objectPath, p_sha256: outputSha256, p_mime_type: rendered.contentType, p_byte_size: rendered.buffer.length,
      p_width: rendered.width, p_height: rendered.height, p_recipe: recipe, p_face_regions: transformedFaceRegions,
    })
    if (created.error) throw created.error
    const mediaAssetId = UuidSchema.parse(created.data)

    const signed = await service.storage.from('rendered-media').createSignedUrl(objectPath, 600)
    if (signed.error) throw signed.error

    return reply.code(201).send(RenderPhotoLayoutResponseSchema.parse({ mediaAssetId, objectPath, signedUrl: signed.data.signedUrl }))
  })
}
