import { ApplyImageStyleRenderRequestSchema, ApplyImageStyleRenderResponseSchema, ImageStylePresetSchema, UuidSchema } from '@vereinsfunk/contracts'
import { isPostEditable, postStatuses } from '@vereinsfunk/domain'
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { parseSupabaseData } from '../supabase.js'
import { mapImageStylePresetRow } from '../apiMappers.js'
import { hashLogoBuffer } from '@vereinsfunk/brand-assets'
import { renderImageStyle, type ImageStyleRenderResult } from '../imageStyle.js'
import type { ApiRouteContext } from './context.js'
import { isSelectableInScope } from '../services/brandAssetSelection.js'
import { toPermissionScope } from '../services/scopeAuthorization.js'
import { downloadBrandAssetBuffer, loadResolvedBrandColors } from '../services/brandResolution.js'
import { renderRejection } from '../services/imageStyleRendering.js'

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
  post_version_not_current: 409,
}

export function registerImageStyleRenderRoutes(app: FastifyInstance, context: ApiRouteContext): void {
  const { requireAuth, requirePermission, supabaseClients } = context

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
    // wie beim Anhaengen eines Fotos in routes/textWorkshop.ts. Die Sichtbarkeit haengt stattdessen am
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
    // Vorabpruefung fuer eine fruehe Antwort; verbindlich prueft apply_image_style_render
    // (2026101940) erneut, denn waehrend des Renderings kann eine neue Fassung entstehen.
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
    if (!isSelectableInScope(preset, scope))
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

    let rendered: ImageStyleRenderResult
    try {
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
      rendered = await renderImageStyle({
        sourceBuffer,
        preset,
        brandColors,
        ...(context.imageEffects ? { imageEffects: context.imageEffects } : {}),
        ...(frameAssetBuffer ? { frameAssetBuffer } : {}),
        ...(logoAssetBuffer ? { logoAssetBuffer } : {}),
      })
    } catch (error) {
      const rejection = renderRejection(error)
      if (!rejection) throw error
      return reply.code(rejection.status).send({ error: rejection.error, correlationId: request.id })
    }
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
