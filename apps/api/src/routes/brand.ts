import {
  BrandAssetSchema,
  BrandLogoUploadResponseSchema,
  BrandLogoVariantSchema,
  ConfirmBrandAssetLicenseRequestSchema,
  CreateBrandAssetRequestSchema,
  DepartmentBrandSchema,
  OrganizationBrandSchema,
  OrganizationBrandUpdateSchema,
  TeamBrandSchema,
  UpdateDepartmentBrandRequestSchema,
  UpdateTeamBrandRequestSchema,
  UuidSchema,
} from '@vereinsfunk/contracts'
import { isBrandAssetSelectable, type BrandAssetRef, type ScopeLevelName } from '@vereinsfunk/domain'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { firstBlockedBrandField, mapBrandAssetRow, mapBrandRow, mapDepartmentBrandRow, mapTeamBrandRow, setsAnyBrandField } from '../apiMappers.js'
import { generateSvgRasterDerivatives, SvgRasterizationError } from '../brandAssetDerivatives.js'
import { FontEmbeddingRestrictedError, processBrandFontUpload, UnsupportedFontFormatError } from '../brandFont.js'
import { hashLogoBuffer, LogoDimensionsError, processBrandLogoUpload, UnsupportedLogoFormatError } from '../brandLogo.js'
import type { ApiRouteContext } from './context.js'
import { toPermissionScope } from './shared.js'

// Exportiert, weil apps/api/src/routes/imageStyle.ts (Plan 045, PR 1) dieselbe Waehlbarkeits-
// Vorabpruefung fuer frame_brand_asset_id/logo_brand_asset_id braucht -- die DB-CHECK
// (authz.brand_asset_is_selectable in der RLS-Policy) bleibt die eigentliche Sicherheitsgrenze,
// dieser Aufruf liefert nur die fruehere, freundlichere 400-Antwort (wie hier fuer
// logoAssetId/displayFontAssetId/bodyFontAssetId bereits Praxis).
export async function loadSelectableBrandAsset(
  client: SupabaseClient,
  organizationId: string,
  assetId: string,
  targetScope: ScopeLevelName,
  targetDepartmentId: string | undefined,
  targetTeamId: string | undefined,
): Promise<{ id: string; kind: string } | null> {
  const result = await client
    .from('brand_assets')
    .select('id, kind, department_id, team_id, status')
    .eq('organization_id', organizationId)
    .eq('id', assetId)
    .maybeSingle()
  if (result.error) throw result.error
  if (!result.data || result.data.status !== 'ready') return null
  const asset: BrandAssetRef = {
    scope: result.data.department_id === null ? 'organization' : result.data.team_id === null ? 'department' : 'team',
    departmentId: result.data.department_id ?? undefined,
    teamId: result.data.team_id ?? undefined,
  }
  if (!isBrandAssetSelectable(asset, targetScope, targetDepartmentId, targetTeamId)) return null
  return { id: result.data.id as string, kind: result.data.kind as string }
}

const LOGO_ASSET_KINDS = new Set(['logo_primary', 'logo_light', 'logo_dark', 'logo_mark', 'wordmark', 'watermark'])

export function registerBrandRoutes(app: FastifyInstance, context: ApiRouteContext): void {
  const { requireAuth, requirePermission, supabaseClients } = context

app.put('/v1/organizations/:id/brand', async (request, reply) => {
  if (!(await requireAuth(request, reply))) return
  const params = z.object({ id: UuidSchema }).parse(request.params)
  const input = OrganizationBrandUpdateSchema.parse(request.body)
  // brand.manage statt organization.manage (Plan 013): organization_owner/-admin erhalten es
  // automatisch (jede Permission ausser billing.manage), fuer alle anderen Rollen aendert sich
  // nichts gegenueber vorher -- nur der Name der durchgesetzten Berechtigung.
  if (!(await requirePermission(request, reply, 'brand.manage', { organizationId: params.id }))) return
  const client = supabaseClients.forUser(request.auth!.accessToken)
  for (const [assetId, expectedKind] of [
    [input.displayFontAssetId, 'font'],
    [input.bodyFontAssetId, 'font'],
  ] as const) {
    if (!assetId) continue
    const asset = await loadSelectableBrandAsset(client, params.id, assetId, 'organization', undefined, undefined)
    if (!asset || asset.kind !== expectedKind) {
      return reply.code(400).send({ error: 'invalid_asset_reference', correlationId: request.id })
    }
  }
  const payload: Record<string, unknown> = {
    primary_color: input.primaryColor,
    accent_color: input.accentColor,
    background_color: input.backgroundColor,
    text_color: input.textColor,
    on_primary_color: input.onPrimaryColor,
    display_font_key: input.displayFontKey,
    body_font_key: input.bodyFontKey,
  }
  if (input.displayFontAssetId !== undefined) payload.display_font_asset_id = input.displayFontAssetId
  if (input.bodyFontAssetId !== undefined) payload.body_font_asset_id = input.bodyFontAssetId
  if (input.allowDepartmentOverrides !== undefined) payload.allow_department_overrides = input.allowDepartmentOverrides
  if (input.lockedFields !== undefined) payload.locked_fields = input.lockedFields
  const update = await client.from('organization_brand_profiles').update(payload).eq('organization_id', params.id).select().single()
  if (update.error) throw update.error
  return reply.code(200).send(OrganizationBrandSchema.parse(mapBrandRow(update.data)))
})

app.post('/v1/organizations/:id/brand/logo', async (request, reply) => {
  if (!(await requireAuth(request, reply))) return
  const params = z.object({ id: UuidSchema }).parse(request.params)
  if (!(await requirePermission(request, reply, 'brand.manage', { organizationId: params.id }))) return

  const filePart = await request.file()
  if (!filePart) return reply.code(400).send({ error: 'invalid_request', correlationId: request.id })

  let processed
  let variant: 'light' | 'dark'
  try {
    // `filePart.fields` is populated as busboy parses the multipart stream, so a field
    // declared after the file part is only present once the file's stream -- drained here
    // via toBuffer() -- has fully flushed. Reading it afterwards makes the route independent
    // of whether the client sends `variant` before or after the file part.
    const buffer = await filePart.toBuffer()
    const variantField = filePart.fields.variant
    const variantValue = variantField && 'value' in variantField ? variantField.value : undefined
    variant = BrandLogoVariantSchema.parse(variantValue)
    processed = await processBrandLogoUpload(buffer)
  } catch (error) {
    if (error instanceof UnsupportedLogoFormatError || error instanceof LogoDimensionsError) {
      return reply.code(400).send({ error: 'invalid_logo', message: error.message, correlationId: request.id })
    }
    // @fastify/multipart throws FST_REQ_FILE_TOO_LARGE (413) from toBuffer() itself, not
    // from a route handler return -- it must be caught here or it falls through to the
    // generic 500 handler below.
    if (error instanceof Error && 'code' in error && error.code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.code(413).send({ error: 'file_too_large', correlationId: request.id })
    }
    throw error
  }

  const objectPath = `organizations/${params.id}/brand/${variant}-${hashLogoBuffer(processed.buffer)}.${processed.extension}`
  const service = supabaseClients.forService()
  const upload = await service.storage
    .from('brand-assets')
    .upload(objectPath, processed.buffer, { contentType: processed.contentType, upsert: true })
  if (upload.error) throw upload.error
  const signed = await service.storage.from('brand-assets').createSignedUrl(objectPath, 600)
  if (signed.error) throw signed.error

  const column = variant === 'light' ? 'logo_path' : 'logo_dark_path'
  const brandUpdate = await service.from('organization_brand_profiles').update({ [column]: objectPath }).eq('organization_id', params.id)
  if (brandUpdate.error) throw brandUpdate.error

  // Design-Entscheidung (Plan 013): der bestehende Logo-Upload wird auf brand_assets
  // umgestellt statt eine Parallelstruktur zu schaffen -- logo_path/logo_dark_path bleiben
  // denormalisierte Zeiger auf das jeweils aktuelle 'ready'-Asset. Assets werden nie
  // ersetzt, nur abgeloest (Plan 013, "Umsetzung"): die vorige Zeile derselben Kind/Ebene
  // wird 'replaced', bevor die neue eingefuegt wird.
  const assetKind = variant === 'light' ? 'logo_primary' : 'logo_dark'
  const supersede = await service
    .from('brand_assets')
    .update({ status: 'replaced' })
    .eq('organization_id', params.id)
    .is('department_id', null)
    .is('team_id', null)
    .eq('kind', assetKind)
    .eq('status', 'ready')
  if (supersede.error) throw supersede.error
  // upsert statt insert: object_path traegt den Inhalts-Hash und ist per unique(bucket_id,
  // object_path) eindeutig. Wird dieselbe Datei ein zweites Mal hochgeladen, entsteht derselbe
  // Pfad -- ein reines insert scheiterte dann an der Eindeutigkeit, nachdem der Supersede-Schritt
  // die vorhandene Zeile bereits auf 'replaced' gesetzt hatte. Der Verein stuende danach ohne
  // aktives Logo-Asset da, und der Aufruf endete in einer 500.
  const assetInsert = await service
    .from('brand_assets')
    .upsert(
      {
        organization_id: params.id,
        department_id: null,
        team_id: null,
        kind: assetKind,
        object_path: objectPath,
        mime_type: processed.contentType,
        byte_size: processed.buffer.length,
        sha256: hashLogoBuffer(processed.buffer),
        width: processed.width ?? null,
        height: processed.height ?? null,
        status: 'ready',
        created_by: request.auth!.userId,
      },
      { onConflict: 'bucket_id,object_path' },
    )
    .select()
    .single()
  if (assetInsert.error) throw assetInsert.error

  const audit = await service.from('audit_events').insert({
    organization_id: params.id,
    actor_user_id: request.auth!.userId,
    action: 'organization.brand_logo_uploaded',
    entity_type: 'organization_brand_profiles',
    entity_id: params.id,
    correlation_id: request.id,
    metadata: { variant, sanitized: processed.sanitized, brandAssetId: assetInsert.data.id },
  })
  if (audit.error) request.log.error({ err: audit.error, correlationId: request.id }, 'audit_events insert failed')

  return reply.code(201).send(
    BrandLogoUploadResponseSchema.parse({ variant, path: objectPath, signedUrl: signed.data.signedUrl, sanitized: processed.sanitized }),
  )
})

app.post('/v1/brand/assets', async (request, reply) => {
  if (!(await requireAuth(request, reply))) return

  const filePart = await request.file()
  if (!filePart) return reply.code(400).send({ error: 'invalid_request', correlationId: request.id })

  let fields: z.infer<typeof CreateBrandAssetRequestSchema>
  let buffer: Buffer
  try {
    // Wie beim Logo-Upload: die Datei zuerst vollstaendig lesen, danach die begleitenden
    // multipart-Felder auswerten -- busboy fuellt filePart.fields erst, sobald der
    // Datei-Stream durchgelaufen ist.
    buffer = await filePart.toBuffer()
    const rawFields = Object.fromEntries(
      Object.entries(filePart.fields).map(([key, field]) => [key, field && 'value' in field ? field.value : undefined]),
    )
    fields = CreateBrandAssetRequestSchema.parse(rawFields)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.code(413).send({ error: 'file_too_large', correlationId: request.id })
    }
    if (error instanceof z.ZodError) return reply.code(400).send({ error: 'invalid_request', correlationId: request.id })
    throw error
  }

  const scope = toPermissionScope(fields.organizationId, fields.departmentId, fields.teamId)
  if (!(await requirePermission(request, reply, 'brand.manage', scope))) return

  // Auf Vereinsebene fuehren logo_path/logo_dark_path den denormalisierten Zeiger auf das
  // jeweils aktuelle 'ready'-Asset. Nur der dedizierte Endpunkt pflegt sie mit; kaeme ein
  // logo_primary/logo_dark hier durch, wuerde das bisherige Asset auf 'replaced' gesetzt,
  // waehrend der Zeiger unveraendert darauf zeigt -- das neue Logo tauchte nirgends auf.
  // Abteilungen und Mannschaften haben keinen solchen Zeiger (sie waehlen ueber logo_asset_id).
  if (!fields.departmentId && (fields.kind === 'logo_primary' || fields.kind === 'logo_dark')) {
    return reply.code(400).send({ error: 'use_organization_logo_endpoint', correlationId: request.id })
  }

  if (fields.teamId) {
    const client = supabaseClients.forUser(request.auth!.accessToken)
    // organization_id mitpruefen, nicht nur department_id: sonst koennte eine echte
    // Team-Mitgliedschaft mit einer davon abweichenden organizationId kombiniert werden, bevor
    // der zusammengesetzte Fremdschluessel beim Insert erst spaeter (als harter 500) eingreift.
    const team = await client.from('teams').select('id').eq('id', fields.teamId).eq('department_id', fields.departmentId!).eq('organization_id', fields.organizationId).maybeSingle()
    if (team.error) throw team.error
    if (!team.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
  } else if (fields.departmentId) {
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const department = await client.from('departments').select('id').eq('id', fields.departmentId).eq('organization_id', fields.organizationId).maybeSingle()
    if (department.error) throw department.error
    if (!department.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
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
        return reply.code(400).send({ error: 'invalid_font', message: error.message, correlationId: request.id })
      }
      if (error instanceof FontEmbeddingRestrictedError) {
        return reply.code(400).send({ error: 'font_embedding_restricted', message: error.message, correlationId: request.id })
      }
      if (error instanceof Error && 'code' in error && error.code === 'FST_REQ_FILE_TOO_LARGE') {
        return reply.code(413).send({ error: 'file_too_large', correlationId: request.id })
      }
      throw error
    }
  } else {
    try {
      processedImage = await processBrandLogoUpload(buffer)
    } catch (error) {
      if (error instanceof UnsupportedLogoFormatError || error instanceof LogoDimensionsError) {
        return reply.code(400).send({ error: 'invalid_logo', message: error.message, correlationId: request.id })
      }
      if (error instanceof Error && 'code' in error && error.code === 'FST_REQ_FILE_TOO_LARGE') {
        return reply.code(413).send({ error: 'file_too_large', correlationId: request.id })
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
    const rawUpload = await service.storage
      .from('raw-media')
      .upload(rawObjectPath, processedFont.originalBuffer, { contentType: processedFont.originalContentType, upsert: true })
    if (rawUpload.error) throw rawUpload.error
    const woff2Upload = await service.storage
      .from('brand-assets')
      .upload(woff2ObjectPath, processedFont.woff2Buffer, { contentType: 'font/woff2', upsert: true })
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
    const upload = await service.storage
      .from('brand-assets')
      .upload(objectPath, processedImage.buffer, { contentType: processedImage.contentType, upsert: true })
    if (upload.error) throw upload.error

    let rasterDerivativePaths: Record<string, string> = {}
    if (processedImage.extension === 'svg') {
      let derivatives
      try {
        derivatives = await generateSvgRasterDerivatives(processedImage.buffer)
      } catch (error) {
        if (error instanceof SvgRasterizationError) {
          return reply.code(400).send({ error: 'invalid_logo', message: error.message, correlationId: request.id })
        }
        throw error
      }
      const derivativeUploads = await Promise.all(
        (Object.entries(derivatives) as [string, Buffer][]).map(async ([size, png]) => {
          const path = `organizations/${fields.organizationId}/brand/${scopeSegment}/${fields.kind}-${hash}-${size}.png`
          const result = await service.storage.from('brand-assets').upload(path, png, { contentType: 'image/png', upsert: true })
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

  if (insertPayload.status === 'ready') {
    const supersede = await service
      .from('brand_assets')
      .update({ status: 'replaced' })
      .eq('organization_id', fields.organizationId)
      .eq('kind', fields.kind)
      .eq('status', 'ready')
      .filter('department_id', fields.departmentId ? 'eq' : 'is', fields.departmentId ?? null)
      .filter('team_id', fields.teamId ? 'eq' : 'is', fields.teamId ?? null)
    if (supersede.error) throw supersede.error
  }

  // Wie beim Logo-Endpunkt: derselbe Dateiinhalt ergibt denselben object_path, und
  // unique(bucket_id, object_path) liesse ein reines insert beim zweiten Hochladen scheitern.
  const insert = await service.from('brand_assets').upsert(insertPayload, { onConflict: 'bucket_id,object_path' }).select().single()
  if (insert.error) throw insert.error

  const audit = await service.from('audit_events').insert({
    organization_id: fields.organizationId,
    actor_user_id: request.auth!.userId,
    action: 'brand_asset.uploaded',
    entity_type: 'brand_assets',
    entity_id: insert.data.id,
    correlation_id: request.id,
    metadata: { kind: fields.kind, departmentId: fields.departmentId ?? null, teamId: fields.teamId ?? null },
  })
  if (audit.error) request.log.error({ err: audit.error, correlationId: request.id }, 'audit_events insert failed')

  return reply.code(201).send(BrandAssetSchema.parse(mapBrandAssetRow(insert.data)))
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
  if (!existing.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
  if (existing.data.kind !== 'font') return reply.code(400).send({ error: 'not_a_font_asset', correlationId: request.id })

  const scope = toPermissionScope(existing.data.organization_id as string, existing.data.department_id as string | null, existing.data.team_id as string | null)
  if (!(await requirePermission(request, reply, 'brand.manage', scope))) return

  const service = supabaseClients.forService()
  // Abgeloest wird nur DIESELBE Schrift (Familie, Schnitt, Lage) -- anders als ein Logo ist eine
  // Schrift kein Platz, den es je Ebene nur einmal gibt: das Markenprofil kennt eine Ueberschriften-
  // und eine Fliesstextschrift, und der Plan sieht mehrere eigene Schriftdateien je Verein vor.
  // Ein Supersede ueber kind = 'font' allein haette beim Bestaetigen der zweiten Schrift die
  // erste entwertet und damit unreferenzierbar gemacht.
  const supersede = await service
    .from('brand_assets')
    .update({ status: 'replaced' })
    .eq('organization_id', existing.data.organization_id)
    .eq('kind', 'font')
    .eq('status', 'ready')
    .eq('font_family', existing.data.font_family)
    .eq('font_weight', existing.data.font_weight)
    .eq('font_style', existing.data.font_style)
    .filter('department_id', existing.data.department_id ? 'eq' : 'is', existing.data.department_id ?? null)
    .filter('team_id', existing.data.team_id ? 'eq' : 'is', existing.data.team_id ?? null)
  if (supersede.error) throw supersede.error

  const update = await service
    .from('brand_assets')
    .update({
      license_holder: input.licenseHolder,
      license_note: input.licenseNote ?? null,
      license_confirmed_at: new Date().toISOString(),
      license_confirmed_by: request.auth!.userId,
      status: 'ready',
    })
    .eq('id', params.id)
    .select()
    .single()
  if (update.error) throw update.error

  const audit = await service.from('audit_events').insert({
    organization_id: existing.data.organization_id,
    actor_user_id: request.auth!.userId,
    action: 'brand_asset.license_confirmed',
    entity_type: 'brand_assets',
    entity_id: params.id,
    correlation_id: request.id,
    metadata: { licenseHolder: input.licenseHolder },
  })
  if (audit.error) request.log.error({ err: audit.error, correlationId: request.id }, 'audit_events insert failed')

  return reply.code(200).send(BrandAssetSchema.parse(mapBrandAssetRow(update.data)))
})

app.put('/v1/departments/:id/brand', async (request, reply) => {
  if (!(await requireAuth(request, reply))) return
  const params = z.object({ id: UuidSchema }).parse(request.params)
  const input = UpdateDepartmentBrandRequestSchema.parse(request.body)
  const client = supabaseClients.forUser(request.auth!.accessToken)
  const department = await client.from('departments').select('organization_id').eq('id', params.id).maybeSingle()
  if (department.error) throw department.error
  if (!department.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
  const organizationId = department.data.organization_id as string
  if (!(await requirePermission(request, reply, 'brand.manage', { organizationId, departmentId: params.id }))) return

  // Ueber die Service Role, nicht ueber den Nutzer-Client: ob die Sperre greift, darf nicht davon
  // abhaengen, ob die Aufruferin das Vereinsprofil selbst lesen darf -- sonst liefe die Pruefung
  // fuer genau die Rollen ins Leere, fuer die sie gedacht ist. Die Berechtigung im Ziel-Scope ist
  // an dieser Stelle bereits geprueft.
  const organizationBrand = await supabaseClients
    .forService()
    .from('organization_brand_profiles')
    .select('allow_department_overrides, locked_fields')
    .eq('organization_id', organizationId)
    .maybeSingle()
  if (organizationBrand.error) throw organizationBrand.error
  if (organizationBrand.data && setsAnyBrandField(input) && !organizationBrand.data.allow_department_overrides) {
    return reply.code(400).send({ error: 'overrides_not_allowed', correlationId: request.id })
  }
  const blockedField = firstBlockedBrandField(input, (organizationBrand.data?.locked_fields as string[] | null) ?? [])
  if (blockedField) return reply.code(400).send({ error: 'field_locked', field: blockedField, correlationId: request.id })

  for (const [assetId, expectedKinds] of [
    [input.logoAssetId, LOGO_ASSET_KINDS],
    [input.displayFontAssetId, new Set(['font'])],
    [input.bodyFontAssetId, new Set(['font'])],
  ] as const) {
    if (!assetId) continue
    const asset = await loadSelectableBrandAsset(client, organizationId, assetId, 'department', params.id, undefined)
    if (!asset || !expectedKinds.has(asset.kind)) {
      return reply.code(400).send({ error: 'invalid_asset_reference', correlationId: request.id })
    }
  }

  const payload: Record<string, unknown> = { organization_id: organizationId, department_id: params.id, updated_by: request.auth!.userId }
  if (input.primaryColor !== undefined) payload.primary_color = input.primaryColor
  if (input.accentColor !== undefined) payload.accent_color = input.accentColor
  if (input.logoAssetId !== undefined) payload.logo_asset_id = input.logoAssetId
  if (input.displayFontAssetId !== undefined) payload.display_font_asset_id = input.displayFontAssetId
  if (input.bodyFontAssetId !== undefined) payload.body_font_asset_id = input.bodyFontAssetId
  if (input.allowTeamOverrides !== undefined) payload.allow_team_overrides = input.allowTeamOverrides
  if (input.lockedFields !== undefined) payload.locked_fields = input.lockedFields

  const upsert = await client.from('department_brand_profiles').upsert(payload, { onConflict: 'organization_id,department_id' }).select().single()
  if (upsert.error) throw upsert.error
  return reply.code(200).send(DepartmentBrandSchema.parse(mapDepartmentBrandRow(upsert.data)))
})

app.put('/v1/teams/:id/brand', async (request, reply) => {
  if (!(await requireAuth(request, reply))) return
  const params = z.object({ id: UuidSchema }).parse(request.params)
  const input = UpdateTeamBrandRequestSchema.parse(request.body)
  const client = supabaseClients.forUser(request.auth!.accessToken)
  const team = await client.from('teams').select('organization_id, department_id').eq('id', params.id).maybeSingle()
  if (team.error) throw team.error
  if (!team.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
  const organizationId = team.data.organization_id as string
  const departmentId = team.data.department_id as string
  if (!(await requirePermission(request, reply, 'brand.manage', { organizationId, departmentId, teamId: params.id }))) return

  // Beide Ebenen daruber zaehlen: die Vereinssperre gilt fuer die Mannschaft auch dann, wenn die
  // Abteilung sie nicht wiederholt, und eine Abteilung, die selbst nicht abweichen darf, kann das
  // Recht nicht an ihre Mannschaften weiterreichen (siehe resolveBrand in packages/domain).
  // Wie beim Abteilungsendpunkt ueber die Service Role -- siehe dort.
  const service = supabaseClients.forService()
  const [organizationBrand, departmentBrand] = await Promise.all([
    service.from('organization_brand_profiles').select('allow_department_overrides, locked_fields').eq('organization_id', organizationId).maybeSingle(),
    service.from('department_brand_profiles').select('allow_team_overrides, locked_fields').eq('organization_id', organizationId).eq('department_id', departmentId).maybeSingle(),
  ])
  if (organizationBrand.error) throw organizationBrand.error
  if (departmentBrand.error) throw departmentBrand.error
  const teamOverridesAllowed =
    (organizationBrand.data?.allow_department_overrides ?? true) && (departmentBrand.data?.allow_team_overrides ?? true)
  if (setsAnyBrandField(input) && !teamOverridesAllowed) {
    return reply.code(400).send({ error: 'overrides_not_allowed', correlationId: request.id })
  }
  const lockedFields = [
    ...((organizationBrand.data?.locked_fields as string[] | null) ?? []),
    ...((departmentBrand.data?.locked_fields as string[] | null) ?? []),
  ]
  const blockedField = firstBlockedBrandField(input, lockedFields)
  if (blockedField) return reply.code(400).send({ error: 'field_locked', field: blockedField, correlationId: request.id })

  for (const [assetId, expectedKinds] of [
    [input.logoAssetId, LOGO_ASSET_KINDS],
    [input.displayFontAssetId, new Set(['font'])],
    [input.bodyFontAssetId, new Set(['font'])],
  ] as const) {
    if (!assetId) continue
    const asset = await loadSelectableBrandAsset(client, organizationId, assetId, 'team', departmentId, params.id)
    if (!asset || !expectedKinds.has(asset.kind)) {
      return reply.code(400).send({ error: 'invalid_asset_reference', correlationId: request.id })
    }
  }

  const payload: Record<string, unknown> = {
    organization_id: organizationId,
    department_id: departmentId,
    team_id: params.id,
    updated_by: request.auth!.userId,
  }
  if (input.primaryColor !== undefined) payload.primary_color = input.primaryColor
  if (input.accentColor !== undefined) payload.accent_color = input.accentColor
  if (input.logoAssetId !== undefined) payload.logo_asset_id = input.logoAssetId
  if (input.displayFontAssetId !== undefined) payload.display_font_asset_id = input.displayFontAssetId
  if (input.bodyFontAssetId !== undefined) payload.body_font_asset_id = input.bodyFontAssetId

  const upsert = await client.from('team_brand_profiles').upsert(payload, { onConflict: 'organization_id,department_id,team_id' }).select().single()
  if (upsert.error) throw upsert.error
  return reply.code(200).send(TeamBrandSchema.parse(mapTeamBrandRow(upsert.data)))
})
}
