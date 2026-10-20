import { BrandWebsiteAnalysisStatusResponseSchema, StartBrandWebsiteAnalysisRequestSchema, UuidSchema } from '@vereinsfunk/contracts'
import { z } from 'zod'
import { isAllowedOutboundUrl } from '@vereinsfunk/outbound-fetch'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { parseSupabaseData } from '../supabase.js'
import type { ApiRouteContext } from './context.js'
import { authorizeDepartmentBrand } from './brand.js'

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

// start_brand_website_analysis liefert jsonb; ohne Pruefung ginge ein unerwartetes Format als
// jobId: undefined an den Client.
const StartBrandWebsiteAnalysisResultSchema = z.object({ jobId: UuidSchema })

// Fehler, die start_brand_website_analysis selbst meldet. department_not_in_organization ist in
// der Praxis unerreichbar (organizationId stammt aus der Abteilung selbst), die RPC prueft es aber
// als eigene Schutzschicht -- dieselbe Abbildung wie organization_has_no_department statt 500.
const START_WEBSITE_ANALYSIS_ERROR_STATUS: Record<string, number> = {
  analysis_in_progress: 409,
  organization_has_no_department: 422,
  department_not_in_organization: 422,
}

export function registerBrandWebsiteAnalysisRoutes(app: FastifyInstance, context: ApiRouteContext): void {
  const { requireAuth, requirePermission, supabaseClients } = context

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

  // Die Homepage wird als Markenwert gepflegt. Der Analyse-Request übergibt bewusst keine URL,
  // damit der Worker immer genau die gespeicherte Adresse der jeweiligen Ebene abruft.
  async function startBrandWebsiteAnalysis(
    request: FastifyRequest,
    reply: FastifyReply,
    organizationId: string,
    departmentId?: string,
  ) {
    const service = supabaseClients.forService()
    const profile = departmentId
      ? await service
          .from('department_brand_profiles')
          .select('website_url')
          .eq('organization_id', organizationId)
          .eq('department_id', departmentId)
          .maybeSingle()
      : await service
          .from('organization_brand_profiles')
          .select('website_url')
          .eq('organization_id', organizationId)
          .maybeSingle()
    if (profile.error) throw profile.error
    const websiteUrl = profile.data?.website_url
    if (!websiteUrl)
      return reply.code(422).send({ error: 'website_url_missing', correlationId: request.id })
    if (!isAllowedOutboundUrl(websiteUrl)) {
      return reply.code(400).send({ error: 'website_url_not_allowed', correlationId: request.id })
    }
    const result = await service.rpc('start_brand_website_analysis', {
      p_organization_id: organizationId,
      p_website_url: websiteUrl,
      p_requested_by: request.auth!.userId,
      ...(departmentId ? { p_department_id: departmentId } : {}),
    })
    if (result.error) {
      const status = START_WEBSITE_ANALYSIS_ERROR_STATUS[result.error.message]
      if (status === undefined) throw result.error
      return reply.code(status).send({ error: result.error.message, correlationId: request.id })
    }
    return reply
      .code(202)
      .send({ jobId: parseSupabaseData(StartBrandWebsiteAnalysisResultSchema, result.data).jobId })
  }

  async function sendBrandWebsiteAnalysisStatus(
    request: FastifyRequest,
    reply: FastifyReply,
    organizationId: string,
    departmentId?: string,
  ) {
    const service = supabaseClients.forService()
    // is('department_id', null) ist seit Paket 049 notwendig: derselbe organization_id-Wert steht
    // jetzt auch auf jeder Abteilungs-Job-Zeile, maybeSingle() wuerde sonst bei mehr als einer
    // Zeile fuer den Verein einen Fehler werfen.
    const query = service
      .from('brand_website_analysis_jobs')
      .select('status, result, error_reason')
      .eq('organization_id', organizationId)
    const row = await (departmentId
      ? query.eq('department_id', departmentId)
      : query.is('department_id', null)
    ).maybeSingle()
    if (row.error) throw row.error
    if (!row.data)
      return reply.code(404).send({ error: 'no_analysis_yet', correlationId: request.id })
    return reply.code(200).send(await mapBrandWebsiteAnalysisRow(service, row.data, organizationId))
  }

  app.post('/v1/organizations/:id/brand/website-analysis', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    if (!(await requirePermission(request, reply, 'brand.manage', { organizationId: params.id })))
      return
    StartBrandWebsiteAnalysisRequestSchema.parse(request.body ?? {})
    return startBrandWebsiteAnalysis(request, reply, params.id)
  })

  app.get('/v1/organizations/:id/brand/website-analysis', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    if (!(await requirePermission(request, reply, 'brand.manage', { organizationId: params.id })))
      return
    return sendBrandWebsiteAnalysisStatus(request, reply, params.id)
  })

  app.post('/v1/departments/:id/brand/website-analysis', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const organizationId = await authorizeDepartmentBrand(context, request, reply, params.id)
    if (organizationId === null) return
    StartBrandWebsiteAnalysisRequestSchema.parse(request.body ?? {})
    // Ein bereits vorhandenes Abteilungsprofil bleibt beim spaeteren Deaktivieren der
    // Überschreibungen bestehen. Der Start eines kostenpflichtigen Analyse-Jobs muss dieselbe
    // Grenze daher serverseitig durchsetzen wie das Speichern eines Abteilungs-Overrides.
    const organizationBrand = await supabaseClients
      .forService()
      .from('organization_brand_profiles')
      .select('allow_department_overrides')
      .eq('organization_id', organizationId)
      .maybeSingle()
    if (organizationBrand.error) throw organizationBrand.error
    if (organizationBrand.data && !organizationBrand.data.allow_department_overrides) {
      return reply.code(400).send({ error: 'overrides_not_allowed', correlationId: request.id })
    }
    return startBrandWebsiteAnalysis(request, reply, organizationId, params.id)
  })

  app.get('/v1/departments/:id/brand/website-analysis', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const organizationId = await authorizeDepartmentBrand(context, request, reply, params.id)
    if (organizationId === null) return
    return sendBrandWebsiteAnalysisStatus(request, reply, organizationId, params.id)
  })
}
