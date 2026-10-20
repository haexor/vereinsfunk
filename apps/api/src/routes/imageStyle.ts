import {
  CreateImageStylePresetRequestSchema,
  ImageStyleFilterPreviewsRequestSchema,
  ImageStyleFilterPreviewsResponseSchema,
  ImageStylePresetSchema,
  PreviewImageStylePresetRequestSchema,
  PreviewImageStylePresetResponseSchema,
  UpdateImageStylePresetRequestSchema,
  UuidSchema,
} from '@vereinsfunk/contracts'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { mapImageStylePresetRow } from '../apiMappers.js'
import type { ApiRouteContext } from './context.js'
import { LOGO_ASSET_KINDS, validateBrandAssetReferences } from '../services/brandAssetSelection.js'
import { checkRateLimit, createAuditRecorder } from './shared.js'
import { resolveDirectoryScope, scopeLevelOf, toPermissionScope } from '../services/scopeAuthorization.js'
import { previewImageStyle, previewImageStyleFilters, renderRejection } from '../services/imageStyleRendering.js'

const FRAME_ASSET_KINDS = new Set(['frame'])

// logoBrandAssetId ist nicht mehr auf kind='watermark' gepinnt (2026082002) -- jede Logovariante
// aus LOGO_ASSET_KINDS ist zulaessig, u.a. das ueber die Marke-Seite hochgeladene Hauptlogo.
function presetAssetReferences(input: {
  frameBrandAssetId?: string | null | undefined
  logoBrandAssetId?: string | null | undefined
}) {
  return [
    [input.frameBrandAssetId, FRAME_ASSET_KINDS],
    [input.logoBrandAssetId, LOGO_ASSET_KINDS],
  ] as const
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

    if (!(await validateBrandAssetReferences(client, input.organizationId, resolvedScope, presetAssetReferences(input))))
      return reply.code(400).send({ error: 'invalid_asset_reference', correlationId: request.id })

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
        scope: scopeLevelOf(input),
      },
    })
    return reply.code(201).send(ImageStylePresetSchema.parse(mapImageStylePresetRow(insert.data)))
  })

  // Zustandslose WYSIWYG-Vorschau eines noch nicht gespeicherten Entwurfs (fabric.js-Editor auf
  // /bildstil). Rendert gegen das feste Beispielfoto statt gegen ein echtes Beitragsfoto -- anders
  // als style-render (routes/imageStyleRender.ts) gibt es hier keinen post_media-Kontext, und ein
  // Aufruf pro debounced Aenderung darf keinen echten Beitrag mutieren. brand.manage statt post.edit: das
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

    if (!(await validateBrandAssetReferences(client, input.organizationId, resolvedScope, presetAssetReferences(input))))
      return reply.code(400).send({ error: 'invalid_asset_reference', correlationId: request.id })

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
      const rejection = renderRejection(error)
      if (!rejection) throw error
      return reply.code(rejection.status).send({ error: rejection.error, correlationId: request.id })
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

    if (!(await validateBrandAssetReferences(client, scope.organizationId, scope, presetAssetReferences(input))))
      return reply.code(400).send({ error: 'invalid_asset_reference', correlationId: request.id })

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
}
