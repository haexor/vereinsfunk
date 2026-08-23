import {
  BrandAssetSchema,
  BrandWebsiteAnalysisStatusResponseSchema,
  ConfirmBrandAssetLicenseRequestSchema,
  CreateBrandAssetRequestSchema,
  CreateBrandAssetResponseSchema,
  DepartmentBrandSchema,
  OrganizationBrandSchema,
  OrganizationBrandUpdateSchema,
  StartBrandWebsiteAnalysisRequestSchema,
  TeamBrandSchema,
  UpdateDepartmentBrandRequestSchema,
  UpdateTeamBrandRequestSchema,
  UuidSchema,
} from '@vereinsfunk/contracts'
import {
  isBrandAssetSelectable,
  type BrandAssetRef,
  type ScopeLevelName,
} from '@vereinsfunk/domain'
import { isAllowedOutboundUrl } from '@vereinsfunk/outbound-fetch'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  firstBlockedBrandField,
  mapBrandAssetRow,
  mapBrandRow,
  mapDepartmentBrandRow,
  mapTeamBrandRow,
  setsAnyBrandField,
} from '../apiMappers.js'
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
    scope:
      result.data.department_id === null
        ? 'organization'
        : result.data.team_id === null
          ? 'department'
          : 'team',
    departmentId: result.data.department_id ?? undefined,
    teamId: result.data.team_id ?? undefined,
  }
  if (!isBrandAssetSelectable(asset, targetScope, targetDepartmentId, targetTeamId)) return null
  return { id: result.data.id as string, kind: result.data.kind as string }
}

// Exportiert, weil apps/api/src/routes/imageStyle.ts (Bildstil-Nachbesserung) dieselbe Menge
// braucht: logo_brand_asset_id ist seit der Lockerung des Fremdschluessels (2026082002) nicht mehr
// auf kind='watermark' gepinnt, sondern akzeptiert jede hier gelistete Logovariante.
export const LOGO_ASSET_KINDS = new Set([
  'logo_primary',
  'logo_light',
  'logo_dark',
  'logo_mark',
  'wordmark',
  'watermark',
])

// brand_website_analysis_jobs.result ist jsonb und damit auch bei einem durch den Worker
// geschriebenen Wert eine Systemgrenze. Nur diese drei Formate kann processBrandLogoUpload in
// den privaten brand-assets-Bucket schreiben; unbekannte Werte duerfen nie zum Service-Role-
// Signing gelangen.
const StoredBrandWebsiteAnalysisLogoCandidateSchema = z
  .object({
    objectPath: z.string().min(1).max(512),
    mimeType: z.enum(['image/svg+xml', 'image/png', 'image/jpeg']),
  })
  .strict()
const MAX_STORED_LOGO_CANDIDATES = 8

export function registerBrandRoutes(app: FastifyInstance, context: ApiRouteContext): void {
  const { requireAuth, requirePermission, supabaseClients } = context

  app.put('/v1/organizations/:id/brand', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = OrganizationBrandUpdateSchema.parse(request.body)
    // brand.manage statt organization.manage (Plan 013): organization_owner/-admin erhalten es
    // automatisch (jede Permission ausser billing.manage), fuer alle anderen Rollen aendert sich
    // nichts gegenueber vorher -- nur der Name der durchgesetzten Berechtigung.
    if (!(await requirePermission(request, reply, 'brand.manage', { organizationId: params.id })))
      return
    const client = supabaseClients.forUser(request.auth!.accessToken)
    for (const [assetId, expectedKinds] of [
      [input.logoAssetId, LOGO_ASSET_KINDS],
      [input.displayFontAssetId, new Set(['font'])],
      [input.bodyFontAssetId, new Set(['font'])],
    ] as const) {
      if (!assetId) continue
      const asset = await loadSelectableBrandAsset(
        client,
        params.id,
        assetId,
        'organization',
        undefined,
        undefined,
      )
      if (!asset || !expectedKinds.has(asset.kind)) {
        return reply.code(400).send({ error: 'invalid_asset_reference', correlationId: request.id })
      }
    }
    const payload: Record<string, unknown> = {
      primary_color: input.primaryColor,
      accent_color: input.accentColor,
      display_font_key: input.displayFontKey,
      body_font_key: input.bodyFontKey,
    }
    if (input.displayFontAssetId !== undefined)
      payload.display_font_asset_id = input.displayFontAssetId
    if (input.bodyFontAssetId !== undefined) payload.body_font_asset_id = input.bodyFontAssetId
    if (input.logoAssetId !== undefined) payload.logo_asset_id = input.logoAssetId
    if (input.websiteUrl !== undefined) payload.website_url = input.websiteUrl
    if (input.allowDepartmentOverrides !== undefined)
      payload.allow_department_overrides = input.allowDepartmentOverrides
    if (input.lockedFields !== undefined) payload.locked_fields = input.lockedFields
    const update = await client
      .from('organization_brand_profiles')
      .update(payload)
      .eq('organization_id', params.id)
      .select()
      .single()
    if (update.error) throw update.error
    return reply.code(200).send(OrganizationBrandSchema.parse(mapBrandRow(update.data)))
  })

  // Von der Vereins- und der Abteilungs-GET-Route geteilt (Paket 049): baut die HTTP-Antwort aus
  // einer brand_website_analysis_jobs-Zeile, unabhaengig vom Scope.
  async function mapBrandWebsiteAnalysisRow(
    service: SupabaseClient,
    row: { status: string; result: unknown; error_reason: string | null },
    organizationId: string,
  ): Promise<unknown> {
    let result: unknown = null
    if (row.result) {
      const stored = row.result as Record<string, unknown>
      // Bei jedem Abruf frisch erzeugt statt gespeichert: eine Signed URL kann waehrend eines
      // langen Polls verfallen, siehe Plandokument. Parallel signiert, da die Kandidatenzahl
      // (bis zu 8, siehe MAX_LOGO_SUGGESTIONS im Worker) unabhaengige Storage-Aufrufe sind.
      // logoCandidate ist das Format vor der Mehrfachlogo-Migration. Es wird nur gelesen, wenn die neue Liste
      // tatsaechlich fehlt -- eine bewusst leere neue Liste darf keinen alten Vorschlag reaktivieren.
      const rawCandidates = Array.isArray(stored.logoCandidates)
        ? stored.logoCandidates
        : stored.logoCandidate === undefined
          ? []
          : [stored.logoCandidate]
      const organizationPathPrefix = `organizations/${organizationId}/brand/analysis-staging/`
      const storedCandidates = rawCandidates
        .flatMap((candidate) => {
          const parsed = StoredBrandWebsiteAnalysisLogoCandidateSchema.safeParse(candidate)
          return parsed.success && parsed.data.objectPath.startsWith(organizationPathPrefix)
            ? [parsed.data]
            : []
        })
        .slice(0, MAX_STORED_LOGO_CANDIDATES)
      const logoCandidates = await Promise.all(
        storedCandidates.map(async (candidate) => {
          const signed = await service.storage
            .from('brand-assets')
            .createSignedUrl(candidate.objectPath, 600)
          if (signed.error) throw signed.error
          return { signedUrl: signed.data.signedUrl, mimeType: candidate.mimeType }
        }),
      )
      result = {
        primaryColor: stored.primaryColor,
        accentColor: stored.accentColor,
        backgroundColor: stored.backgroundColor,
        textColor: stored.textColor,
        onPrimaryColor: stored.onPrimaryColor,
        suggestedFontPairingKey: stored.suggestedFontPairingKey,
        detectedFontFamily: stored.detectedFontFamily,
        // Deprecated compatibility field; selecting the first preserves the previous API semantics.
        logoCandidate: logoCandidates[0] ?? null,
        logoCandidates,
      }
    }
    return BrandWebsiteAnalysisStatusResponseSchema.parse({
      status: row.status,
      result,
      errorReason: row.error_reason,
    })
  }

  // Paket 048: der Verein gibt seine Homepage-URL an, ein Worker-Job leitet daraus per Screenshot
  // + Vision-KI einen Farb-/Font-/Logo-Vorschlag ab. Die RPC ist die einzige Schreibstelle (siehe
  // start_brand_website_analysis, Migration 2026082007) -- diese Route prueft nur die Berechtigung
  // und bildet deren Fehlermeldungen auf HTTP-Antworten ab. Seit Paket 049 gilt dasselbe fuer eine
  // Abteilung (siehe die beiden /v1/departments/:id/brand/website-analysis-Routen unten).
  app.post('/v1/organizations/:id/brand/website-analysis', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    if (!(await requirePermission(request, reply, 'brand.manage', { organizationId: params.id })))
      return
    const input = StartBrandWebsiteAnalysisRequestSchema.parse(request.body)
    // Dieselbe Vorabpruefung wie fuer jede andere vom Verein hinterlegte Adresse, die der Server
    // spaeter selbst abruft (Plan 034, siehe channels.ts/integrations.ts): der Worker rendert genau
    // diese URL mit einem echten Browser. Ohne sie waere die Antwort auf eine gewoehnliche Eingabe
    // ausserdem eine 500 -- brand_website_analysis_jobs.website_url hat ein CHECK auf '^https://',
    // an dem die RPC sonst mit einem nicht abgebildeten Fehler scheitert (z.B. bei "http://...").
    if (!isAllowedOutboundUrl(input.websiteUrl)) {
      return reply.code(400).send({ error: 'website_url_not_allowed', correlationId: request.id })
    }
    const service = supabaseClients.forService()
    const result = await service.rpc('start_brand_website_analysis', {
      p_organization_id: params.id,
      p_website_url: input.websiteUrl,
      p_requested_by: request.auth!.userId,
    })
    if (result.error) {
      if (result.error.message === 'analysis_in_progress')
        return reply.code(409).send({ error: 'analysis_in_progress', correlationId: request.id })
      if (result.error.message === 'organization_has_no_department')
        return reply
          .code(422)
          .send({ error: 'organization_has_no_department', correlationId: request.id })
      throw result.error
    }
    return reply.code(202).send({ jobId: (result.data as { jobId: string }).jobId })
  })

  app.get('/v1/organizations/:id/brand/website-analysis', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    if (!(await requirePermission(request, reply, 'brand.manage', { organizationId: params.id })))
      return
    const service = supabaseClients.forService()
    // is('department_id', null) ist seit Paket 049 notwendig: derselbe organization_id-Wert steht
    // jetzt auch auf jeder Abteilungs-Job-Zeile, maybeSingle() wuerde sonst bei mehr als einer
    // Zeile fuer den Verein einen Fehler werfen.
    const row = await service
      .from('brand_website_analysis_jobs')
      .select('status, result, error_reason')
      .eq('organization_id', params.id)
      .is('department_id', null)
      .maybeSingle()
    if (row.error) throw row.error
    if (!row.data)
      return reply.code(404).send({ error: 'no_analysis_yet', correlationId: request.id })
    return reply.code(200).send(await mapBrandWebsiteAnalysisRow(service, row.data, params.id))
  })

  app.post('/v1/departments/:id/brand/website-analysis', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const department = await supabaseClients
      .forUser(request.auth!.accessToken)
      .from('departments')
      .select('organization_id')
      .eq('id', params.id)
      .maybeSingle()
    if (department.error) throw department.error
    if (!department.data)
      return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const organizationId = department.data.organization_id as string
    if (
      !(await requirePermission(
        request,
        reply,
        'brand.manage',
        toPermissionScope(organizationId, params.id),
      ))
    )
      return
    const input = StartBrandWebsiteAnalysisRequestSchema.parse(request.body)
    if (!isAllowedOutboundUrl(input.websiteUrl)) {
      return reply.code(400).send({ error: 'website_url_not_allowed', correlationId: request.id })
    }
    const service = supabaseClients.forService()
    const result = await service.rpc('start_brand_website_analysis', {
      p_organization_id: organizationId,
      p_website_url: input.websiteUrl,
      p_requested_by: request.auth!.userId,
      p_department_id: params.id,
    })
    if (result.error) {
      if (result.error.message === 'analysis_in_progress')
        return reply.code(409).send({ error: 'analysis_in_progress', correlationId: request.id })
      // In der Praxis unerreichbar (organizationId stammt oben aus der Abteilung selbst), aber die
      // RPC prueft es trotzdem als eigene Schutzschicht (siehe Migration) -- dieselbe Abbildung wie
      // 'organization_has_no_department' bei der Vereinsroute statt eines unspezifischen 500.
      if (result.error.message === 'department_not_in_organization')
        return reply
          .code(422)
          .send({ error: 'department_not_in_organization', correlationId: request.id })
      throw result.error
    }
    return reply.code(202).send({ jobId: (result.data as { jobId: string }).jobId })
  })

  app.get('/v1/departments/:id/brand/website-analysis', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const department = await supabaseClients
      .forUser(request.auth!.accessToken)
      .from('departments')
      .select('organization_id')
      .eq('id', params.id)
      .maybeSingle()
    if (department.error) throw department.error
    if (!department.data)
      return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (
      !(await requirePermission(
        request,
        reply,
        'brand.manage',
        toPermissionScope(department.data.organization_id as string, params.id),
      ))
    )
      return
    const service = supabaseClients.forService()
    const row = await service
      .from('brand_website_analysis_jobs')
      .select('status, result, error_reason')
      .eq('department_id', params.id)
      .maybeSingle()
    if (row.error) throw row.error
    if (!row.data)
      return reply.code(404).send({ error: 'no_analysis_yet', correlationId: request.id })
    return reply
      .code(200)
      .send(
        await mapBrandWebsiteAnalysisRow(
          service,
          row.data,
          department.data.organization_id as string,
        ),
      )
  })

  app.post('/v1/brand/assets', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return

    const filePart = await request.file()
    if (!filePart)
      return reply.code(400).send({ error: 'invalid_request', correlationId: request.id })

    let fields: z.infer<typeof CreateBrandAssetRequestSchema>
    let buffer: Buffer
    try {
      // Wie beim Logo-Upload: die Datei zuerst vollstaendig lesen, danach die begleitenden
      // multipart-Felder auswerten -- busboy fuellt filePart.fields erst, sobald der
      // Datei-Stream durchgelaufen ist.
      buffer = await filePart.toBuffer()
      const rawFields = Object.fromEntries(
        Object.entries(filePart.fields).map(([key, field]) => [
          key,
          field && 'value' in field ? field.value : undefined,
        ]),
      )
      fields = CreateBrandAssetRequestSchema.parse(rawFields)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'FST_REQ_FILE_TOO_LARGE') {
        return reply.code(413).send({ error: 'file_too_large', correlationId: request.id })
      }
      if (error instanceof z.ZodError)
        return reply.code(400).send({ error: 'invalid_request', correlationId: request.id })
      throw error
    }

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
          return reply
            .code(400)
            .send({ error: 'invalid_logo', message: error.message, correlationId: request.id })
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
      const upload = await service.storage
        .from('brand-assets')
        .upload(objectPath, processedImage.buffer, {
          contentType: processedImage.contentType,
          upsert: true,
        })
      if (upload.error) throw upload.error

      let rasterDerivativePaths: Record<string, string> = {}
      if (processedImage.extension === 'svg') {
        let derivatives
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

    const audit = await service.from('audit_events').insert({
      organization_id: fields.organizationId,
      actor_user_id: request.auth!.userId,
      action: 'brand_asset.uploaded',
      entity_type: 'brand_assets',
      entity_id: insert.data.id,
      correlation_id: request.id,
      metadata: {
        kind: fields.kind,
        departmentId: fields.departmentId ?? null,
        teamId: fields.teamId ?? null,
      },
    })
    if (audit.error)
      request.log.error(
        { err: audit.error, correlationId: request.id },
        'audit_events insert failed',
      )

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

    const audit = await service.from('audit_events').insert({
      organization_id: existing.data.organization_id,
      actor_user_id: request.auth!.userId,
      action: 'brand_asset.deleted',
      entity_type: 'brand_assets',
      entity_id: params.id,
      correlation_id: request.id,
      metadata: {},
    })
    if (audit.error)
      request.log.error(
        { err: audit.error, correlationId: request.id },
        'audit_events insert failed',
      )

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
      .filter(
        'department_id',
        existing.data.department_id ? 'eq' : 'is',
        existing.data.department_id ?? null,
      )
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
    if (audit.error)
      request.log.error(
        { err: audit.error, correlationId: request.id },
        'audit_events insert failed',
      )

    return reply.code(200).send(BrandAssetSchema.parse(mapBrandAssetRow(update.data)))
  })

  app.put('/v1/departments/:id/brand', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = UpdateDepartmentBrandRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const department = await client
      .from('departments')
      .select('organization_id')
      .eq('id', params.id)
      .maybeSingle()
    if (department.error) throw department.error
    if (!department.data)
      return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const organizationId = department.data.organization_id as string
    if (
      !(await requirePermission(request, reply, 'brand.manage', {
        organizationId,
        departmentId: params.id,
      }))
    )
      return

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
    if (
      organizationBrand.data &&
      setsAnyBrandField(input) &&
      !organizationBrand.data.allow_department_overrides
    ) {
      return reply.code(400).send({ error: 'overrides_not_allowed', correlationId: request.id })
    }
    const blockedField = firstBlockedBrandField(
      input,
      (organizationBrand.data?.locked_fields as string[] | null) ?? [],
    )
    if (blockedField)
      return reply
        .code(400)
        .send({ error: 'field_locked', field: blockedField, correlationId: request.id })

    for (const [assetId, expectedKinds] of [
      [input.logoAssetId, LOGO_ASSET_KINDS],
      [input.displayFontAssetId, new Set(['font'])],
      [input.bodyFontAssetId, new Set(['font'])],
    ] as const) {
      if (!assetId) continue
      const asset = await loadSelectableBrandAsset(
        client,
        organizationId,
        assetId,
        'department',
        params.id,
        undefined,
      )
      if (!asset || !expectedKinds.has(asset.kind)) {
        return reply.code(400).send({ error: 'invalid_asset_reference', correlationId: request.id })
      }
    }

    const payload: Record<string, unknown> = {
      organization_id: organizationId,
      department_id: params.id,
      updated_by: request.auth!.userId,
    }
    if (input.primaryColor !== undefined) payload.primary_color = input.primaryColor
    if (input.accentColor !== undefined) payload.accent_color = input.accentColor
    if (input.logoAssetId !== undefined) payload.logo_asset_id = input.logoAssetId
    if (input.websiteUrl !== undefined) payload.website_url = input.websiteUrl
    if (input.displayFontAssetId !== undefined)
      payload.display_font_asset_id = input.displayFontAssetId
    if (input.bodyFontAssetId !== undefined) payload.body_font_asset_id = input.bodyFontAssetId
    if (input.allowTeamOverrides !== undefined)
      payload.allow_team_overrides = input.allowTeamOverrides
    if (input.lockedFields !== undefined) payload.locked_fields = input.lockedFields

    const upsert = await client
      .from('department_brand_profiles')
      .upsert(payload, { onConflict: 'organization_id,department_id' })
      .select()
      .single()
    if (upsert.error) throw upsert.error
    return reply.code(200).send(DepartmentBrandSchema.parse(mapDepartmentBrandRow(upsert.data)))
  })

  app.put('/v1/teams/:id/brand', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = UpdateTeamBrandRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const team = await client
      .from('teams')
      .select('organization_id, department_id')
      .eq('id', params.id)
      .maybeSingle()
    if (team.error) throw team.error
    if (!team.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const organizationId = team.data.organization_id as string
    const departmentId = team.data.department_id as string
    if (
      !(await requirePermission(request, reply, 'brand.manage', {
        organizationId,
        departmentId,
        teamId: params.id,
      }))
    )
      return

    // Beide Ebenen daruber zaehlen: die Vereinssperre gilt fuer die Mannschaft auch dann, wenn die
    // Abteilung sie nicht wiederholt, und eine Abteilung, die selbst nicht abweichen darf, kann das
    // Recht nicht an ihre Mannschaften weiterreichen (siehe resolveBrand in packages/domain).
    // Wie beim Abteilungsendpunkt ueber die Service Role -- siehe dort.
    const service = supabaseClients.forService()
    const [organizationBrand, departmentBrand] = await Promise.all([
      service
        .from('organization_brand_profiles')
        .select('allow_department_overrides, locked_fields')
        .eq('organization_id', organizationId)
        .maybeSingle(),
      service
        .from('department_brand_profiles')
        .select('allow_team_overrides, locked_fields')
        .eq('organization_id', organizationId)
        .eq('department_id', departmentId)
        .maybeSingle(),
    ])
    if (organizationBrand.error) throw organizationBrand.error
    if (departmentBrand.error) throw departmentBrand.error
    const teamOverridesAllowed =
      (organizationBrand.data?.allow_department_overrides ?? true) &&
      (departmentBrand.data?.allow_team_overrides ?? true)
    if (setsAnyBrandField(input) && !teamOverridesAllowed) {
      return reply.code(400).send({ error: 'overrides_not_allowed', correlationId: request.id })
    }
    const lockedFields = [
      ...((organizationBrand.data?.locked_fields as string[] | null) ?? []),
      ...((departmentBrand.data?.locked_fields as string[] | null) ?? []),
    ]
    const blockedField = firstBlockedBrandField(input, lockedFields)
    if (blockedField)
      return reply
        .code(400)
        .send({ error: 'field_locked', field: blockedField, correlationId: request.id })

    for (const [assetId, expectedKinds] of [
      [input.logoAssetId, LOGO_ASSET_KINDS],
      [input.displayFontAssetId, new Set(['font'])],
      [input.bodyFontAssetId, new Set(['font'])],
    ] as const) {
      if (!assetId) continue
      const asset = await loadSelectableBrandAsset(
        client,
        organizationId,
        assetId,
        'team',
        departmentId,
        params.id,
      )
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
    if (input.displayFontAssetId !== undefined)
      payload.display_font_asset_id = input.displayFontAssetId
    if (input.bodyFontAssetId !== undefined) payload.body_font_asset_id = input.bodyFontAssetId

    const upsert = await client
      .from('team_brand_profiles')
      .upsert(payload, { onConflict: 'organization_id,department_id,team_id' })
      .select()
      .single()
    if (upsert.error) throw upsert.error
    return reply.code(200).send(TeamBrandSchema.parse(mapTeamBrandRow(upsert.data)))
  })
}
