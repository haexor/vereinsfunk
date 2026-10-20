import {
  BrandAssetSchema,
  ConfirmBrandAssetLicenseRequestSchema,
  CreateBrandAssetRequestSchema,
  CreateBrandAssetResponseSchema,
  UuidSchema,
} from '@vereinsfunk/contracts'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { mapBrandAssetRow } from '../apiMappers.js'
import { generateSvgRasterDerivatives, SvgRasterizationError } from '../brandAssetDerivatives.js'
import {
  FontEmbeddingRestrictedError,
  processBrandFontUpload,
  UnsupportedFontFormatError,
} from '../brandFont.js'
import {
  hashLogoBuffer,
  LogoDimensionsError,
  processBrandLogoUpload,
  UnsupportedLogoFormatError,
} from '@vereinsfunk/brand-assets'
import { readMultipartUpload } from '../multipartUpload.js'
import type { ApiRouteContext } from './context.js'
import { createAuditRecorder } from './shared.js'
import { toPermissionScope } from '../services/scopeAuthorization.js'

// confirm_brand_font_license prueft Status und Art selbst noch einmal unter Zeilensperre.
const CONFIRM_LICENSE_ERROR_STATUS: Record<string, number> = {
  brand_asset_not_found: 404,
  not_a_font_asset: 400,
  brand_asset_not_pending_license: 409,
}

export function registerBrandAssetRoutes(app: FastifyInstance, context: ApiRouteContext): void {
  const { requireAuth, requirePermission, supabaseClients } = context
  const recordAuditEvent = createAuditRecorder(supabaseClients)

  app.post('/v1/brand/assets', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return

    const upload = await readMultipartUpload(request, CreateBrandAssetRequestSchema)
    if (!upload.ok) return reply.code(upload.status).send({ error: upload.error, correlationId: request.id })
    const { buffer, fields } = upload

    const scope = toPermissionScope(fields.organizationId, fields.departmentId, fields.teamId)
    if (!(await requirePermission(request, reply, 'brand.manage', scope))) return

    if (fields.teamId) {
      const client = supabaseClients.forUser(request.auth!.accessToken)
      // organization_id mitpruefen, nicht nur department_id: sonst koennte eine echte
      // Team-Mitgliedschaft mit einer davon abweichenden organizationId kombiniert werden, bevor
      // der zusammengesetzte Fremdschluessel beim Insert erst spaeter (als harter 500) eingreift.
      const team = await client
        .from('teams')
        .select('id')
        .eq('id', fields.teamId)
        .eq('department_id', fields.departmentId!)
        .eq('organization_id', fields.organizationId)
        .maybeSingle()
      if (team.error) throw team.error
      if (!team.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    } else if (fields.departmentId) {
      const client = supabaseClients.forUser(request.auth!.accessToken)
      const department = await client
        .from('departments')
        .select('id')
        .eq('id', fields.departmentId)
        .eq('organization_id', fields.organizationId)
        .maybeSingle()
      if (department.error) throw department.error
      if (!department.data)
        return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    }

    // Validierung des Dateiinhalts laeuft vor jedem Service-Role-Aufruf (wie beim bestehenden
    // Logo-Upload): eine abgelehnte Datei braucht nie einen echten Supabase-Client.
    let processedFont: Awaited<ReturnType<typeof processBrandFontUpload>> | undefined
    let processedImage: Awaited<ReturnType<typeof processBrandLogoUpload>> | undefined
    if (fields.kind === 'font') {
      try {
        processedFont = await processBrandFontUpload(buffer)
      } catch (error) {
        if (error instanceof UnsupportedFontFormatError) {
          return reply
            .code(400)
            .send({ error: 'invalid_font', message: error.message, correlationId: request.id })
        }
        if (error instanceof FontEmbeddingRestrictedError) {
          return reply
            .code(400)
            .send({
              error: 'font_embedding_restricted',
              message: error.message,
              correlationId: request.id,
            })
        }
        throw error
      }
    } else {
      try {
        processedImage = await processBrandLogoUpload(buffer)
      } catch (error) {
        if (error instanceof UnsupportedLogoFormatError || error instanceof LogoDimensionsError) {
          return reply
            .code(400)
            .send({ error: 'invalid_logo', message: error.message, correlationId: request.id })
        }
        throw error
      }
    }

    const service = supabaseClients.forService()
    const scopeSegment = fields.teamId
      ? `departments/${fields.departmentId}/teams/${fields.teamId}`
      : fields.departmentId
        ? `departments/${fields.departmentId}`
        : 'organization'

    const insertPayload: Record<string, unknown> = {
      organization_id: fields.organizationId,
      department_id: fields.departmentId ?? null,
      team_id: fields.teamId ?? null,
      kind: fields.kind,
      created_by: request.auth!.userId,
    }

    if (processedFont) {
      const hash = hashLogoBuffer(processedFont.woff2Buffer)
      const rawObjectPath = `organizations/${fields.organizationId}/brand/${scopeSegment}/font-${hash}-original.${processedFont.originalExtension}`
      const woff2ObjectPath = `organizations/${fields.organizationId}/brand/${scopeSegment}/font-${hash}.woff2`
      // Dieselbe Schriftdatei erneut hochgeladen: das upsert unten setzte eine bereits lizenzierte,
      // womoeglich von Markenprofilen ausgewaehlte Schrift zurueck auf 'processing' -- die Profile
      // zeigten danach auf ein nicht waehlbares Asset. Die vorhandene Zeile bleibt unveraendert.
      const readyFont = await service
        .from('brand_assets')
        .select()
        .eq('organization_id', fields.organizationId)
        .eq('object_path', woff2ObjectPath)
        .eq('status', 'ready')
        .maybeSingle()
      if (readyFont.error) throw readyFont.error
      if (readyFont.data) {
        return reply
          .code(200)
          .send(CreateBrandAssetResponseSchema.parse({ ...mapBrandAssetRow(readyFont.data), sanitized: false }))
      }
      const rawUpload = await service.storage
        .from('raw-media')
        .upload(rawObjectPath, processedFont.originalBuffer, {
          contentType: processedFont.originalContentType,
          upsert: true,
        })
      if (rawUpload.error) throw rawUpload.error
      const woff2Upload = await service.storage
        .from('brand-assets')
        .upload(woff2ObjectPath, processedFont.woff2Buffer, {
          contentType: 'font/woff2',
          upsert: true,
        })
      if (woff2Upload.error) throw woff2Upload.error
      Object.assign(insertPayload, {
        object_path: woff2ObjectPath,
        source_object_path: rawObjectPath,
        mime_type: 'font/woff2',
        byte_size: processedFont.woff2Buffer.length,
        sha256: hash,
        font_family: processedFont.fontFamily,
        font_weight: processedFont.fontWeight,
        font_style: processedFont.fontStyle,
        status: 'processing',
      })
    } else if (processedImage) {
      const hash = hashLogoBuffer(processedImage.buffer)
      const objectPath = `organizations/${fields.organizationId}/brand/${scopeSegment}/${fields.kind}-${hash}.${processedImage.extension}`
      // Rastern vor jedem Upload: ein erst danach abgelehntes SVG liess sein Original verwaist im
      // Bucket zurueck.
      let derivatives: Record<string, Buffer> | undefined
      if (processedImage.extension === 'svg') {
        try {
          derivatives = await generateSvgRasterDerivatives(processedImage.buffer)
        } catch (error) {
          if (error instanceof SvgRasterizationError) {
            return reply
              .code(400)
              .send({ error: 'invalid_logo', message: error.message, correlationId: request.id })
          }
          throw error
        }
      }
      const upload = await service.storage
        .from('brand-assets')
        .upload(objectPath, processedImage.buffer, {
          contentType: processedImage.contentType,
          upsert: true,
        })
      if (upload.error) throw upload.error

      let rasterDerivativePaths: Record<string, string> = {}
      if (derivatives) {
        const derivativeUploads = await Promise.all(
          (Object.entries(derivatives) as [string, Buffer][]).map(async ([size, png]) => {
            const path = `organizations/${fields.organizationId}/brand/${scopeSegment}/${fields.kind}-${hash}-${size}.png`
            const result = await service.storage
              .from('brand-assets')
              .upload(path, png, { contentType: 'image/png', upsert: true })
            if (result.error) throw result.error
            return [size, path] as const
          }),
        )
        rasterDerivativePaths = Object.fromEntries(derivativeUploads)
      }

      Object.assign(insertPayload, {
        object_path: objectPath,
        mime_type: processedImage.contentType,
        byte_size: processedImage.buffer.length,
        sha256: hash,
        width: processedImage.width ?? null,
        height: processedImage.height ?? null,
        raster_derivative_paths: rasterDerivativePaths,
        status: 'ready',
      })
    }

    // Kein Supersede des Vorgaenger-Assets hier: jedes ueber diese Route erreichbare Kind -- auch
    // logo_primary/logo_dark auf Vereinsebene, seit die dedizierte Logo-Route entfallen ist -- kann
    // per fester ID referenziert werden, entweder von organization_brand_profiles.logo_asset_id/
    // department_brand_profiles.logo_asset_id/team_brand_profiles.logo_asset_id (gegen
    // LOGO_ASSET_KINDS geprueft) oder von image_style_presets.frame_brand_asset_id/
    // logo_brand_asset_id. loadSelectableBrandAsset verlangt dort status='ready'; ein Supersede
    // wuerde jede bereits getroffene Auswahl beim naechsten unabhaengigen Speichern mit
    // invalid_asset_reference scheitern lassen, ohne dass die UI einen Ausweg zeigt. Alte Zeilen
    // bleiben deshalb 'ready' liegen -- ein Aufraeumen ungenutzter Assets ist bewusst keine
    // automatische Nebenwirkung des Uploads (siehe DELETE /v1/brand/assets/:id fuer den expliziten
    // Weg dahin).

    // Derselbe Dateiinhalt ergibt denselben object_path, und unique(bucket_id, object_path) liesse
    // ein reines insert beim zweiten Hochladen scheitern.
    const insert = await service
      .from('brand_assets')
      .upsert(insertPayload, { onConflict: 'bucket_id,object_path' })
      .select()
      .single()
    if (insert.error) throw insert.error

    await recordAuditEvent(request, { organizationId: fields.organizationId, action: 'brand_asset.uploaded', entityType: 'brand_assets', entityId: insert.data.id, metadata: {
        kind: fields.kind,
        departmentId: fields.departmentId ?? null,
        teamId: fields.teamId ?? null,
      } })

    // sanitized ist bewusst kein Feld von BrandAssetSchema (der persistierten Asset-Zeile), sondern
    // eine einmalige Nebeninformation dieser Antwort -- der Onboarding-Wizard zeigt damit denselben
    // Hinweis wie /marke, wenn ein SVG nicht unterstuetzte Elemente enthielt.
    return reply
      .code(201)
      .send(
        CreateBrandAssetResponseSchema.parse({
          ...mapBrandAssetRow(insert.data),
          sanitized: processedImage?.sanitized ?? false,
        }),
      )
  })

  // Ersetzt die beiden dedizierten Logo-Endpunkte (siehe Loeschung oben): "aktives Logo entfernen"
  // ist seit logo_asset_id (PUT .../brand mit logoAssetId: null) bereits moeglich, es fehlte nur
  // noch ein Weg, ein einzelnes Asset aus der Galerie zu entfernen -- unabhaengig davon, ob es
  // gerade als aktives Logo einer Ebene gesetzt ist.
  app.delete('/v1/brand/assets/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    // Ueber den Nutzer-eigenen Client, aus demselben Grund wie bei confirm-license: ein Asset
    // ausserhalb des eigenen Scopes liefert so "nicht gefunden" statt vor der Berechtigungspruefung
    // per Service Role Existenz und Scope eines fremden Assets zu verraten.
    const existing = await client
      .from('brand_assets')
      .select('organization_id, department_id, team_id, status')
      .eq('id', params.id)
      .maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data)
      return reply.code(404).send({ error: 'not_found', correlationId: request.id })

    const scope = toPermissionScope(
      existing.data.organization_id as string,
      existing.data.department_id as string | null,
      existing.data.team_id as string | null,
    )
    if (!(await requirePermission(request, reply, 'brand.manage', scope))) return

    const service = supabaseClients.forService()
    // Soft-Delete statt DELETE FROM: brand_assets wird von nicht-kaskadierenden Fremdschluesseln aus
    // organization_/department_/team_brand_profiles sowie image_style_presets referenziert. Pruefung
    // und Status-Aenderung laufen deshalb atomar in delete_brand_asset_if_unused() (Migration
    // 2026082206) -- ein separates .eq('status','ready') vor einem ungesperrten Update haette ein
    // noch referenziertes Asset loeschen und die referenzierende Profilzeile mit einer toten
    // Referenz zuruecklassen koennen (Review-Fund PR #138).
    const deletion = await service.rpc('delete_brand_asset_if_unused', {
      target_asset_id: params.id,
    })
    if (deletion.error) {
      if (deletion.error.message.includes('brand_asset_referenced'))
        return reply.code(409).send({ error: 'asset_referenced', correlationId: request.id })
      throw deletion.error
    }
    if (!deletion.data)
      return reply.code(404).send({ error: 'not_found', correlationId: request.id })

    await recordAuditEvent(request, { organizationId: existing.data.organization_id, action: 'brand_asset.deleted', entityType: 'brand_assets', entityId: params.id, metadata: {} })

    return reply.code(204).send()
  })

  app.post('/v1/brand/assets/:id/confirm-license', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = ConfirmBrandAssetLicenseRequestSchema.parse(request.body)

    // Ueber den Nutzer-eigenen Client lesen, nicht per Service Role: brand_assets_select traegt
    // bereits die Abschottung zwischen Abteilungen/Mannschaften (siehe Migration) durch -- ein
    // Asset ausserhalb des eigenen Vereins/Scopes liefert so schon "nicht gefunden", statt vor
    // der Berechtigungspruefung per Service Role Existenz und Art eines fremden Assets zu verraten.
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const existing = await client.from('brand_assets').select().eq('id', params.id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data)
      return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (existing.data.kind !== 'font')
      return reply.code(400).send({ error: 'not_a_font_asset', correlationId: request.id })

    const scope = toPermissionScope(
      existing.data.organization_id as string,
      existing.data.department_id as string | null,
      existing.data.team_id as string | null,
    )
    if (!(await requirePermission(request, reply, 'brand.manage', scope))) return

    // Abgeloest wird nur DIESELBE Schrift (Familie, Schnitt, Lage) -- anders als ein Logo ist eine
    // Schrift kein Platz, den es je Ebene nur einmal gibt: das Markenprofil kennt eine Ueberschriften-
    // und eine Fliesstextschrift, und der Plan sieht mehrere eigene Schriftdateien je Verein vor.
    // Statusvorbedingung ('processing'), Abloesung nur nicht mehr ausgewaehlter Schriften und die
    // Freigabe laufen atomar in confirm_brand_font_license() (Migration 2026101941).
    const confirmed = await supabaseClients.forService().rpc('confirm_brand_font_license', {
      p_organization_id: existing.data.organization_id,
      p_asset_id: params.id,
      p_license_holder: input.licenseHolder,
      p_license_note: input.licenseNote ?? null,
      p_actor_user_id: request.auth!.userId,
    })
    if (confirmed.error) {
      const status = CONFIRM_LICENSE_ERROR_STATUS[confirmed.error.message]
      if (status === undefined) throw confirmed.error
      return reply.code(status).send({ error: confirmed.error.message, correlationId: request.id })
    }

    await recordAuditEvent(request, { organizationId: existing.data.organization_id, action: 'brand_asset.license_confirmed', entityType: 'brand_assets', entityId: params.id, metadata: { licenseHolder: input.licenseHolder } })

    return reply.code(200).send(BrandAssetSchema.parse(mapBrandAssetRow(confirmed.data)))
  })
}
