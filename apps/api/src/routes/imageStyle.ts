import {
  ApplyImageStyleRenderRequestSchema,
  ApplyImageStyleRenderResponseSchema,
  CreateImageStylePresetRequestSchema,
  ImageStyleFilterPreviewsRequestSchema,
  ImageStyleFilterPreviewsResponseSchema,
  ImageStyleFilterSchema,
  ImageStylePresetSchema,
  PreviewImageStylePresetRequestSchema,
  PreviewImageStylePresetResponseSchema,
  UpdateImageStylePresetRequestSchema,
  UuidSchema,
  type PreviewImageStylePresetRequest,
} from '@vereinsfunk/contracts'
import {
  isBrandAssetSelectable,
  isPostEditable,
  postStatuses,
  resolveBrand,
  type BrandOverrideProfile,
  type DepartmentBrandLevel,
  type OrganizationBrandLevel,
} from '@vereinsfunk/domain'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { FastifyInstance } from 'fastify'
import sharp from 'sharp'
import { z } from 'zod'
import {
  mapBrandRow,
  mapDepartmentBrandRow,
  mapImageStylePresetRow,
  mapTeamBrandRow,
} from '../apiMappers.js'
import { hashLogoBuffer } from '@vereinsfunk/brand-assets'
import { GmicNotEnabledError, renderImageStyle } from '../imageStyle.js'
import type { ApiRouteContext } from './context.js'
import { loadSelectableBrandAsset, LOGO_ASSET_KINDS } from './brand.js'
import {
  checkRateLimit,
  createAuditRecorder,
  resolveDirectoryScope,
  toPermissionScope,
} from './shared.js'

// Zod an der DB-Grenze statt roher `as string`-Zusicherungen: media_assets.sha256 ist nullable und
// post_media.media_derivative_id koennte theoretisch fehlen -- durchgereicht landen beide als
// `null` im Rezept-Snapshot bzw. in einem `.eq('id', null)` und tauchen erst weit spaeter als
// undurchsichtiger 500 wieder auf. Dieselbe Grenzziehung wie passThroughDerivative.ts/mediaUpload.ts.
const PostMediaRowSchema = z.object({
  organization_id: UuidSchema,
  post_version_id: UuidSchema,
  media_derivative_id: UuidSchema,
})
const PostVersionRowSchema = z.object({ post_id: UuidSchema })
const PostRowSchema = z.object({
  department_id: UuidSchema.nullable(),
  team_id: UuidSchema.nullable(),
  status: z.enum(postStatuses),
  current_version_id: UuidSchema.nullable(),
})
const MediaDerivativeRowSchema = z.object({ media_asset_id: UuidSchema })
const SourceAssetRowSchema = z.object({
  bucket_id: z.string().min(1),
  object_path: z.string().min(1),
  mime_type: z.string().min(1),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
})
const BrandAssetPathRowSchema = z.object({ object_path: z.string().min(1) })

// apply_image_style_render meldet die Faelle, die es selbst noch einmal prueft, per
// `raise exception`. Ohne diese Zuordnung landen sie im generischen Fastify-Fehlerhandler
// (app.ts) und werden zu 500 internal_error -- der Aufrufer koennte einen erwarteten
// Nebenlaeufigkeitskonflikt, den er an anderer Stelle schon als 409 behandelt, nicht von einem
// echten Serverfehler unterscheiden.
const RPC_ERROR_STATUS: Record<string, number> = {
  post_media_not_found: 404,
  post_version_not_found: 404,
  post_not_found: 404,
  post_not_editable: 409,
  post_media_changed: 409,
}

function parseSupabaseData<T>(schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data)
  if (parsed.success) return parsed.data
  const error = new Error('Unexpected Supabase response')
  error.name = 'SupabaseResponseError'
  throw error
}

async function downloadBrandAssetBuffer(
  service: SupabaseClient,
  organizationId: string,
  assetId: string,
): Promise<Buffer> {
  const asset = await service
    .from('brand_assets')
    .select('object_path')
    .eq('id', assetId)
    .eq('organization_id', organizationId)
    .eq('status', 'ready')
    .maybeSingle()
  if (asset.error) throw asset.error
  if (!asset.data) throw new Error('brand_asset_not_ready')
  const download = await service.storage
    .from('brand-assets')
    .download(parseSupabaseData(BrandAssetPathRowSchema, asset.data).object_path)
  if (download.error) throw download.error
  return Buffer.from(await download.data.arrayBuffer())
}

// Die fuer den parametrischen Rahmen und den Duoton-Filter tatsaechlich wirksame Vereinsfarbe --
// dieselbe Vererbungskette (Verein -> Abteilung -> Mannschaft) wie packages/domain's resolveBrand
// sie fuer die Marke-Seite schon aufloest, hier fuer die Zielebene des Beitrags statt fuer eine
// gerade aktive UI-Ebene.
// Exportiert, weil routes/photoLayout.ts (Plan 047, PR 1) dieselbe Vereinsfarben-Aufloesung fuer
// die Trennlinien-/Gutter-Farbe der Bildkomposition braucht -- kein zweiter Aufruf derselben drei
// Abfragen.
export async function loadResolvedBrandColors(
  service: SupabaseClient,
  organizationId: string,
  departmentId: string | null,
  teamId: string | null,
): Promise<{ primaryColor: string; accentColor: string }> {
  const [orgRow, deptRow, teamRow] = await Promise.all([
    service
      .from('organization_brand_profiles')
      .select()
      .eq('organization_id', organizationId)
      .maybeSingle(),
    departmentId
      ? service
          .from('department_brand_profiles')
          .select()
          .eq('organization_id', organizationId)
          .eq('department_id', departmentId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    teamId
      ? service
          .from('team_brand_profiles')
          .select()
          .eq('organization_id', organizationId)
          .eq('team_id', teamId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])
  if (orgRow.error) throw orgRow.error
  if (deptRow.error) throw deptRow.error
  if (teamRow.error) throw teamRow.error

  // mapBrandRow/mapDepartmentBrandRow tragen allowDepartmentOverrides/allowTeamOverrides und
  // lockedFields bereits selbst -- sie hier noch einmal von Hand anzuhaengen war reine Doppelung
  // (locked_fields ist ausserdem `not null default '{}'`, der Ersatzwert lief also ins Leere).
  const organization = orgRow.data
    ? (mapBrandRow(orgRow.data) as unknown as OrganizationBrandLevel)
    : { allowDepartmentOverrides: true, lockedFields: [] }
  const department = deptRow.data
    ? (mapDepartmentBrandRow(deptRow.data) as unknown as DepartmentBrandLevel)
    : null
  const team = teamRow.data
    ? (mapTeamBrandRow(teamRow.data) as unknown as BrandOverrideProfile)
    : null

  const resolved = resolveBrand(organization, department, team)
  return { primaryColor: resolved.primaryColor, accentColor: resolved.accentColor }
}

// Bildstil-Vorschau: rendert einen noch nicht gespeicherten Entwurf gegen das feste Beispielfoto
// (context.samplePhotoLoader). Reine Berechnung -- kein Storage-Upload, kein DB-Write, keine RPC,
// anders als style-render weiter unten.
interface ImageStylePreviewResult {
  imageBase64: string
  contentType: 'image/webp'
  width: number
  height: number
  filterProvider: string
}

// Die Vorschau wird angeschaut, nicht veroeffentlicht -- deshalb NICHT das Format aus encodeResult
// (imageStyle.ts) uebernehmen: das waehlt fuer jedes Ergebnis mit Alpha (abgerundete Ecken,
// 'double'/'festlich'-Rahmen, durchscheinende Rahmengrafik) verlustfreies PNG und liefert damit
// gemessene 4,3 MB -- als Base64 im JSON-Body 5,7 MB, und das bei bis zu 30 Anfragen/Minute je
// Nutzer. WebP q80 auf 1200 px Breite behaelt den Alphakanal, ist auf derselben Messung 0,26 MB
// Base64 und immer noch doppelt so breit wie die Editorspalte je darstellt (~600 CSS-px).
const PREVIEW_MAX_WIDTH = 1200

async function encodePreview(
  buffer: Buffer,
  maxWidth = PREVIEW_MAX_WIDTH,
): Promise<{ buffer: Buffer; width: number; height: number }> {
  const encoded = await sharp(buffer)
    .resize({ width: maxWidth, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer({ resolveWithObject: true })
  return { buffer: encoded.data, width: encoded.info.width, height: encoded.info.height }
}

async function previewImageStyle(
  service: SupabaseClient,
  context: ApiRouteContext,
  input: PreviewImageStylePresetRequest,
  scope: { departmentId?: string; teamId?: string },
): Promise<ImageStylePreviewResult> {
  const [sourceBuffer, frameAssetBuffer, logoAssetBuffer, brandColors] = await Promise.all([
    context.samplePhotoLoader(),
    input.frameType === 'custom' && input.frameBrandAssetId
      ? downloadBrandAssetBuffer(service, input.organizationId, input.frameBrandAssetId)
      : Promise.resolve(undefined),
    input.logoEnabled && input.logoBrandAssetId
      ? downloadBrandAssetBuffer(service, input.organizationId, input.logoBrandAssetId)
      : Promise.resolve(undefined),
    loadResolvedBrandColors(
      service,
      input.organizationId,
      scope.departmentId ?? null,
      scope.teamId ?? null,
    ),
  ])
  const rendered = await renderImageStyle({
    sourceBuffer,
    preset: input,
    brandColors,
    ...(context.imageEffects ? { imageEffects: context.imageEffects } : {}),
    ...(frameAssetBuffer ? { frameAssetBuffer } : {}),
    ...(logoAssetBuffer ? { logoAssetBuffer } : {}),
  })
  const preview = await encodePreview(rendered.buffer)
  return {
    imageBase64: preview.buffer.toString('base64'),
    contentType: 'image/webp',
    width: preview.width,
    height: preview.height,
    filterProvider: rendered.filterProvider,
  }
}

// Die Galerie darf keine CSS-Näherungen verwenden: Gerade G'MIC wirkt erst nach dem
// serverseitigen Rendern. Das Quellfoto und die Markenfarben werden einmal geladen, während
// jeder Filter sein eigenes, kleines WebP erhält. Fehlendes G'MIC ist ein klarer
// Umgebungszustand, kein Grund, einen ähnlich aussehenden Ersatz zu erfinden.
async function previewImageStyleFilters(
  service: SupabaseClient,
  context: ApiRouteContext,
  input: { organizationId: string; departmentId?: string | undefined; teamId?: string | undefined },
  scope: { departmentId?: string; teamId?: string },
): Promise<{ previews: { filter: (typeof ImageStyleFilterSchema.options)[number]; imageBase64: string; contentType: 'image/webp'; filterProvider: string }[]; unavailableFilters: (typeof ImageStyleFilterSchema.options)[number][] }> {
  const [sourceBuffer, brandColors] = await Promise.all([
    context.samplePhotoLoader(),
    loadResolvedBrandColors(service, input.organizationId, scope.departmentId ?? null, scope.teamId ?? null),
  ])
  const previews: { filter: (typeof ImageStyleFilterSchema.options)[number]; imageBase64: string; contentType: 'image/webp'; filterProvider: string }[] = []
  const unavailableFilters: (typeof ImageStyleFilterSchema.options)[number][] = []
  for (const filter of ImageStyleFilterSchema.options) {
    try {
      const rendered = await renderImageStyle({
        sourceBuffer,
        preset: {
          frameType: 'none', frameStyle: null, frameColor: null, frameWidthPx: null,
          frameCornerRadiusPx: null, logoEnabled: false, logoPosition: 'bottom_right',
          logoSizePercent: null, logoMarginPercent: null, filter,
        },
        brandColors,
        ...(context.imageEffects ? { imageEffects: context.imageEffects } : {}),
      })
      const preview = await encodePreview(rendered.buffer, 360)
      previews.push({
        filter,
        imageBase64: preview.buffer.toString('base64'),
        contentType: 'image/webp',
        filterProvider: rendered.filterProvider,
      })
    } catch (error) {
      if (error instanceof GmicNotEnabledError) unavailableFilters.push(filter)
      else throw error
    }
  }
  return { previews, unavailableFilters }
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
    const rows = await client
      .from('image_style_presets')
      .select()
      .eq('organization_id', query.organizationId)
      .order('created_at', { ascending: false })
    if (rows.error) throw rows.error
    return reply.send({
      presets: rows.data.map((row) => ImageStylePresetSchema.parse(mapImageStylePresetRow(row))),
    })
  })

  app.post('/v1/image-style-presets', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const input = CreateImageStylePresetRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    // departmentId/teamId gegen ihre echte organization_id verifizieren, BEVOR die Berechtigung
    // geprueft wird -- sonst waeren sie client-seitig frei kombinierbar (dieselbe Reihenfolge wie
    // /v1/text-generation-platforms, routes/content.ts).
    const resolvedScope = await resolveDirectoryScope(
      client,
      input.organizationId,
      input.departmentId ?? null,
      input.teamId ?? null,
    )
    if (resolvedScope === null)
      return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, 'brand.manage', resolvedScope))) return

    // logoBrandAssetId ist nicht mehr auf kind='watermark' gepinnt (2026082002) -- jede Logovariante
    // aus LOGO_ASSET_KINDS ist zulaessig, u.a. das ueber die Marke-Seite hochgeladene Hauptlogo.
    for (const [assetId, isExpectedKind] of [
      [input.frameBrandAssetId, (kind: string) => kind === 'frame'],
      [input.logoBrandAssetId, (kind: string) => LOGO_ASSET_KINDS.has(kind)],
    ] as const) {
      if (!assetId) continue
      const targetScope = resolvedScope.teamId
        ? 'team'
        : resolvedScope.departmentId
          ? 'department'
          : 'organization'
      const asset = await loadSelectableBrandAsset(
        client,
        input.organizationId,
        assetId,
        targetScope,
        resolvedScope.departmentId,
        resolvedScope.teamId,
      )
      if (!asset || !isExpectedKind(asset.kind))
        return reply.code(400).send({ error: 'invalid_asset_reference', correlationId: request.id })
    }

    const insert = await client
      .from('image_style_presets')
      .insert({
        organization_id: input.organizationId,
        department_id: input.departmentId ?? null,
        team_id: input.teamId ?? null,
        name: input.name,
        frame_type: input.frameType,
        frame_style: input.frameStyle,
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
      metadata: {
        scope: input.teamId ? 'team' : input.departmentId ? 'department' : 'organization',
      },
    })
    return reply.code(201).send(ImageStylePresetSchema.parse(mapImageStylePresetRow(insert.data)))
  })

  // Zustandslose WYSIWYG-Vorschau eines noch nicht gespeicherten Entwurfs (fabric.js-Editor auf
  // /bildstil). Rendert gegen das feste Beispielfoto statt gegen ein echtes Beitragsfoto -- anders
  // als style-render weiter unten gibt es hier keinen post_media-Kontext, und ein Aufruf pro
  // debounced Aenderung darf keinen echten Beitrag mutieren. brand.manage statt post.edit: das
  // Konfigurieren eines Presets ist eine Marken-, keine Beitragsaktion.
  app.post('/v1/image-style-presets/preview', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    // Hoeher als das 10/60s-Muster der LLM-gestuetzten Vorschauen (style-preview): interaktives
    // Ziehen am Logo-Griff feuert debounced oefter als ein "Testen"-Button, und G'MIC deckelt seine
    // eigenen Worst-Case-Kosten bereits ueber den 30s-execFile-Timeout (gmic.ts).
    if (!checkRateLimit(`image-style-preview:${request.auth!.userId}`, 30, 60_000)) {
      return reply.code(429).send({ error: 'rate_limited', correlationId: request.id })
    }
    const input = PreviewImageStylePresetRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const resolvedScope = await resolveDirectoryScope(
      client,
      input.organizationId,
      input.departmentId ?? null,
      input.teamId ?? null,
    )
    if (resolvedScope === null)
      return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, 'brand.manage', resolvedScope))) return

    for (const [assetId, isExpectedKind] of [
      [input.frameBrandAssetId, (kind: string) => kind === 'frame'],
      [input.logoBrandAssetId, (kind: string) => LOGO_ASSET_KINDS.has(kind)],
    ] as const) {
      if (!assetId) continue
      const targetScope = resolvedScope.teamId
        ? 'team'
        : resolvedScope.departmentId
          ? 'department'
          : 'organization'
      const asset = await loadSelectableBrandAsset(
        client,
        input.organizationId,
        assetId,
        targetScope,
        resolvedScope.departmentId,
        resolvedScope.teamId,
      )
      if (!asset || !isExpectedKind(asset.kind))
        return reply.code(400).send({ error: 'invalid_asset_reference', correlationId: request.id })
    }

    // Kein Idempotency-Key/In-Flight-Dedupe wie bei den LLM-Vorschauen (previewStyleProfile,
    // routes/shared.ts): dort schuetzt es vor einem zweiten BEZAHLTEN Provider-Aufruf bei einem
    // Client-Retry. Hier gibt es keinen externen Aufruf, ofetch wiederholt POSTs nicht, und der
    // Client entprellt bereits samt Race-Guard (useImageStylePreviewRequest.ts) -- ein Cache haette
    // ohne mitgeschickten Header nur zufaellige Schluessel und damit garantiert keinen Treffer,
    // wuerde aber jedes gerenderte Bild 60 s im Speicher halten.
    try {
      const result = await previewImageStyle(supabaseClients.forService(), context, input, resolvedScope)
      return reply.code(200).send(PreviewImageStylePresetResponseSchema.parse(result))
    } catch (error) {
      if (error instanceof GmicNotEnabledError)
        return reply.code(422).send({ error: 'gmic_not_enabled', correlationId: request.id })
      if (error instanceof Error && error.message === 'brand_asset_not_ready')
        return reply.code(422).send({ error: 'brand_asset_not_ready', correlationId: request.id })
      throw error
    }
  })

  // Eine Galerieanfrage statt neun Browser-Requests: die API darf die kuratierten Effekte
  // kontrolliert ausführen, der Browser erhält ausschließlich kleine, fertige Vorschauen.
  app.post('/v1/image-style-presets/filter-previews', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    if (!checkRateLimit(`image-style-filter-previews:${request.auth!.userId}`, 6, 60_000)) {
      return reply.code(429).send({ error: 'rate_limited', correlationId: request.id })
    }
    const input = ImageStyleFilterPreviewsRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const resolvedScope = await resolveDirectoryScope(
      client,
      input.organizationId,
      input.departmentId ?? null,
      input.teamId ?? null,
    )
    if (resolvedScope === null)
      return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, 'brand.manage', resolvedScope))) return
    const result = await previewImageStyleFilters(
      supabaseClients.forService(),
      context,
      input,
      resolvedScope,
    )
    return reply.code(200).send(ImageStyleFilterPreviewsResponseSchema.parse(result))
  })

  // Scope ist unveraendlich und wird aus der bestehenden Zeile hergeleitet, nicht aus dem Body
  // uebernommen (plans/README.md, "RPC traut Client nicht") -- ueber den Nutzer-eigenen Client
  // gelesen, damit image_style_presets_select bereits greift: eine Zeile ausserhalb des eigenen
  // Scopes liefert so "nicht gefunden" statt vorab per Service Role Existenz/Scope zu verraten.
  app.patch('/v1/image-style-presets/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const existing = await client
      .from('image_style_presets')
      .select('organization_id, department_id, team_id')
      .eq('id', params.id)
      .maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data)
      return reply
        .code(404)
        .send({ error: 'image_style_preset_not_found', correlationId: request.id })
    const scope = toPermissionScope(
      existing.data.organization_id as string,
      existing.data.department_id as string | null,
      existing.data.team_id as string | null,
    )
    if (!(await requirePermission(request, reply, 'brand.manage', scope))) return
    const input = UpdateImageStylePresetRequestSchema.parse(request.body)

    for (const [assetId, isExpectedKind] of [
      [input.frameBrandAssetId, (kind: string) => kind === 'frame'],
      [input.logoBrandAssetId, (kind: string) => LOGO_ASSET_KINDS.has(kind)],
    ] as const) {
      if (!assetId) continue
      const targetScope = scope.teamId ? 'team' : scope.departmentId ? 'department' : 'organization'
      const asset = await loadSelectableBrandAsset(
        client,
        scope.organizationId,
        assetId,
        targetScope,
        scope.departmentId,
        scope.teamId,
      )
      if (!asset || !isExpectedKind(asset.kind))
        return reply.code(400).send({ error: 'invalid_asset_reference', correlationId: request.id })
    }

    const payload: Record<string, unknown> = {
      name: input.name,
      frame_type: input.frameType,
      frame_style: input.frameStyle,
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
    const update = await client
      .from('image_style_presets')
      .update(payload)
      .eq('id', params.id)
      .select()
      .maybeSingle()
    if (update.error) throw update.error
    if (!update.data)
      return reply
        .code(404)
        .send({ error: 'image_style_preset_not_found', correlationId: request.id })
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
    const existing = await client
      .from('image_style_presets')
      .select('organization_id, department_id, team_id')
      .eq('id', params.id)
      .maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data)
      return reply
        .code(404)
        .send({ error: 'image_style_preset_not_found', correlationId: request.id })
    const scope = toPermissionScope(
      existing.data.organization_id as string,
      existing.data.department_id as string | null,
      existing.data.team_id as string | null,
    )
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
  // apply_image_style_render (Migration 2026081918) Derivat + post_media-Zeiger atomar.
  app.post('/v1/post-media/:postMediaId/style-render', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ postMediaId: UuidSchema }).parse(request.params)
    const input = ApplyImageStyleRenderRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const service = supabaseClients.forService()

    // post_media und post_versions ueber die Service Role: ihre SELECT-Policies gewaehren nur
    // authz.is_organization_member, und wer ueber eine Abteilungs- oder Mannschaftseinladung
    // hereinkommt, hat gar keine organization_memberships-Zeile (accept_invitation, 2026080601,
    // legt dafuer nur department_memberships/team_memberships an). Genau die Redakteure, fuer die
    // diese Route da ist, saehen ihre eigene Beitragsfoto-Zeile also nicht und bekaemen 404, bevor
    // die Berechtigungspruefung ueberhaupt laeuft. Dieselbe Umgehung, mit derselben Begruendung,
    // wie beim Anhaengen eines Fotos in routes/content.ts. Die Sichtbarkeit haengt stattdessen am
    // Beitrag selbst -- posts_select ueber den Nutzer-Client unten -- und am 'post.edit'-Gate.
    const media = await service
      .from('post_media')
      .select('organization_id, post_version_id, media_derivative_id')
      .eq('id', params.postMediaId)
      .maybeSingle()
    if (media.error) throw media.error
    if (!media.data)
      return reply.code(404).send({ error: 'post_media_not_found', correlationId: request.id })
    const mediaRow = parseSupabaseData(PostMediaRowSchema, media.data)
    const organizationId = mediaRow.organization_id

    const version = await service
      .from('post_versions')
      .select('post_id')
      .eq('id', mediaRow.post_version_id)
      .eq('organization_id', organizationId)
      .maybeSingle()
    if (version.error) throw version.error
    if (!version.data)
      return reply.code(404).send({ error: 'post_media_not_found', correlationId: request.id })
    const versionRow = parseSupabaseData(PostVersionRowSchema, version.data)

    const post = await client
      .from('posts')
      .select('department_id, team_id, status, current_version_id')
      .eq('id', versionRow.post_id)
      .eq('organization_id', organizationId)
      .maybeSingle()
    if (post.error) throw post.error
    if (!post.data)
      return reply.code(404).send({ error: 'post_media_not_found', correlationId: request.id })
    const postRow = parseSupabaseData(PostRowSchema, post.data)

    const scope = toPermissionScope(organizationId, postRow.department_id, postRow.team_id)
    if (!(await requirePermission(request, reply, 'post.edit', scope))) return

    if (!isPostEditable(postRow.status)) {
      return reply.code(409).send({ error: 'post_not_editable', correlationId: request.id })
    }

    // Der Status gehoert dem Beitrag, die Foto-Zeile aber einer bestimmten Fassung: aeltere
    // post_versions behalten ihre post_media-Zeilen, und accept_text_generation_candidate setzt
    // den Beitrag beim Anlegen einer neuen Fassung wieder auf 'draft_ready' -- auch nach einer
    // Veroeffentlichung. Ohne diese Pruefung koennte die postMediaId einer archivierten,
    // freigegebenen Fassung uebergeben werden und wuerde deren Bildstand nachtraeglich
    // umschreiben, obwohl publications und approval_media_snapshots weiter darauf zeigen.
    if (postRow.current_version_id !== mediaRow.post_version_id) {
      return reply.code(409).send({ error: 'post_version_not_current', correlationId: request.id })
    }

    const presetRow = await client
      .from('image_style_presets')
      .select()
      .eq('id', input.stylePresetId)
      .eq('organization_id', organizationId)
      .maybeSingle()
    if (presetRow.error) throw presetRow.error
    if (!presetRow.data)
      return reply
        .code(404)
        .send({ error: 'image_style_preset_not_found', correlationId: request.id })
    const preset = ImageStylePresetSchema.parse(mapImageStylePresetRow(presetRow.data))
    if (!preset.isActive)
      return reply
        .code(400)
        .send({ error: 'image_style_preset_not_active', correlationId: request.id })
    const targetScope = scope.teamId ? 'team' : scope.departmentId ? 'department' : 'organization'
    const presetSelectable = isBrandAssetSelectable(
      {
        scope: preset.teamId ? 'team' : preset.departmentId ? 'department' : 'organization',
        ...(preset.departmentId ? { departmentId: preset.departmentId } : {}),
        ...(preset.teamId ? { teamId: preset.teamId } : {}),
      },
      targetScope,
      scope.departmentId,
      scope.teamId,
    )
    if (!presetSelectable)
      return reply
        .code(400)
        .send({ error: 'image_style_preset_not_selectable', correlationId: request.id })

    // media_derivatives_select ist genauso eng geschnitten wie post_media_select, also auch hier
    // die Service Role -- der Zugriff ist an dieser Stelle bereits durch 'post.edit' abgesichert.
    const currentDerivative = await service
      .from('media_derivatives')
      .select('media_asset_id')
      .eq('id', mediaRow.media_derivative_id)
      .eq('organization_id', organizationId)
      .maybeSingle()
    if (currentDerivative.error) throw currentDerivative.error
    if (!currentDerivative.data)
      return reply.code(404).send({ error: 'post_media_not_found', correlationId: request.id })
    const sourceMediaAssetId = parseSupabaseData(
      MediaDerivativeRowSchema,
      currentDerivative.data,
    ).media_asset_id

    const sourceAsset = await service
      .from('media_assets')
      .select('bucket_id, object_path, mime_type, sha256')
      .eq('id', sourceMediaAssetId)
      .eq('organization_id', organizationId)
      .maybeSingle()
    if (sourceAsset.error) throw sourceAsset.error
    if (!sourceAsset.data)
      return reply
        .code(404)
        .send({ error: 'source_media_asset_not_found', correlationId: request.id })
    const assetRow = parseSupabaseData(SourceAssetRowSchema, sourceAsset.data)
    // media_assets nimmt auch video/mp4 auf, und weder die Anhaengeroute noch
    // ensurePassThroughDerivative pruefen den Typ -- ein Video liefe hier ungebremst in sharp und
    // kaeme als 500 zurueck statt als Ablehnung, die die Oberflaeche erklaeren kann.
    if (!assetRow.mime_type.startsWith('image/'))
      return reply
        .code(422)
        .send({ error: 'source_media_asset_not_an_image', correlationId: request.id })
    if (assetRow.sha256 === null)
      return reply
        .code(422)
        .send({ error: 'source_media_asset_not_ready', correlationId: request.id })
    const download = await service.storage.from(assetRow.bucket_id).download(assetRow.object_path)
    if (download.error) throw download.error
    const sourceBuffer = Buffer.from(await download.data.arrayBuffer())

    const [frameAssetBuffer, logoAssetBuffer, brandColors] = await Promise.all([
      preset.frameType === 'custom' && preset.frameBrandAssetId
        ? downloadBrandAssetBuffer(service, organizationId, preset.frameBrandAssetId)
        : Promise.resolve(undefined),
      preset.logoEnabled && preset.logoBrandAssetId
        ? downloadBrandAssetBuffer(service, organizationId, preset.logoBrandAssetId)
        : Promise.resolve(undefined),
      loadResolvedBrandColors(
        service,
        organizationId,
        scope.departmentId ?? null,
        scope.teamId ?? null,
      ),
    ])

    const rendered = await renderImageStyle({
      sourceBuffer,
      preset,
      brandColors,
      ...(context.imageEffects ? { imageEffects: context.imageEffects } : {}),
      ...(frameAssetBuffer ? { frameAssetBuffer } : {}),
      ...(logoAssetBuffer ? { logoAssetBuffer } : {}),
    })
    const outputSha256 = hashLogoBuffer(rendered.buffer)
    // renderImageStyle liefert nur noch image/jpeg oder image/png -- genau die beiden Typen, die
    // der 'rendered-media'-Bucket zulaesst (202608020002_private_storage.sql).
    const extension = rendered.contentType === 'image/jpeg' ? 'jpg' : 'png'
    const objectPath = `organizations/${organizationId}/derivatives/${sourceMediaAssetId}/styled-${preset.id}-${outputSha256}.${extension}`

    const upload = await service.storage
      .from('rendered-media')
      .upload(objectPath, rendered.buffer, { contentType: rendered.contentType, upsert: true })
    if (upload.error) throw upload.error

    const stylePresetSnapshot = {
      name: preset.name,
      frameType: preset.frameType,
      frameStyle: preset.frameStyle,
      frameColor: preset.frameColor,
      frameWidthPx: preset.frameWidthPx,
      frameCornerRadiusPx: preset.frameCornerRadiusPx,
      frameBrandAssetId: preset.frameBrandAssetId,
      logoEnabled: preset.logoEnabled,
      logoBrandAssetId: preset.logoBrandAssetId,
      logoPosition: preset.logoPosition,
      logoSizePercent: preset.logoSizePercent,
      logoMarginPercent: preset.logoMarginPercent,
      filter: preset.filter,
      filterProvider: rendered.filterProvider,
    }
    const recipe = {
      kind: 'image_style_v1',
      stylePresetId: preset.id,
      stylePresetSnapshot,
      sourceMediaAssetId,
      sourceSha256: assetRow.sha256,
    }

    const applied = await service.rpc('apply_image_style_render', {
      p_post_media_id: params.postMediaId,
      p_actor_user_id: request.auth!.userId,
      p_style_preset_id: preset.id,
      p_expected_media_derivative_id: mediaRow.media_derivative_id,
      p_media_asset_id: sourceMediaAssetId,
      p_object_path: objectPath,
      p_sha256: outputSha256,
      p_mime_type: rendered.contentType,
      p_byte_size: rendered.buffer.length,
      p_width: rendered.width,
      p_height: rendered.height,
      p_recipe: recipe,
    })
    // Das hochgeladene Objekt bleibt bei einer Ablehnung liegen: sein Pfad traegt den Hash des
    // Ergebnisses, ein spaeterer Versuch nutzt also genau dieselbe Datei weiter -- und Loeschen
    // wuerde einem parallel erfolgreichen Lauf die Bytes unter dem Derivat wegziehen.
    if (applied.error) {
      const mappedStatus = RPC_ERROR_STATUS[applied.error.message]
      if (mappedStatus === undefined) throw applied.error
      return reply
        .code(mappedStatus)
        .send({ error: applied.error.message, correlationId: request.id })
    }

    const signed = await service.storage.from('rendered-media').createSignedUrl(objectPath, 600)
    if (signed.error) throw signed.error

    return reply
      .code(201)
      .send(
        ApplyImageStyleRenderResponseSchema.parse({
          mediaDerivativeId: applied.data,
          objectPath,
          signedUrl: signed.data.signedUrl,
        }),
      )
  })
}
