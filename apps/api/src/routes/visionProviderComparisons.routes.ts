import { CreateVisionProviderComparisonRunRequestSchema, UuidSchema, VisionProviderComparisonResultEntrySchema, VisionProviderComparisonRunSchema } from '@vereinsfunk/contracts'
import { isAllowedOutboundUrl } from '@vereinsfunk/outbound-fetch'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ApiRouteContext } from './context.js'

const RUN_COLUMNS = 'id, website_url, status, detected_font_family, logo_object_path, logo_mime_type, results, error_reason, created_at'

// Analog mapBrandWebsiteAnalysisRow (routes/brand.ts): eine Signed URL bei jedem Abruf frisch
// erzeugt statt gespeichert, weil sie waehrend eines langen Polls verfallen kann. Anders als dort
// stehen die Ergebnis-Farbfelder schon in der camelCase-Form, in der der Worker sie geschrieben hat
// (VisionComparisonResultEntry) -- keine Transformation je Zeile noetig.
async function mapVisionProviderComparisonRunRow(service: SupabaseClient, row: Record<string, unknown>): Promise<unknown> {
  let logoCandidate: { signedUrl: string; mimeType: string } | null = null
  if (row.logo_object_path) {
    const signed = await service.storage.from('brand-assets').createSignedUrl(row.logo_object_path as string, 600)
    if (signed.error) throw signed.error
    logoCandidate = { signedUrl: signed.data.signedUrl, mimeType: row.logo_mime_type as string }
  }
  return VisionProviderComparisonRunSchema.parse({
    id: row.id,
    websiteUrl: row.website_url,
    status: row.status,
    detectedFontFamily: row.detected_font_family,
    logoCandidate,
    results: VisionProviderComparisonResultEntrySchema.array().parse(row.results),
    errorReason: row.error_reason,
    createdAt: row.created_at,
  })
}

/**
 * Plattform-Admin-Werkzeug (Paket 050): mehrere aktive Vision-Provider gegen dieselbe Test-URL
 * vergleichen, um zu entscheiden, welche Modelle fuer die echte Markenerkennung (routes/brand.ts)
 * aktiv bleiben sollen. Das Anlegen schreibt nur eine 'pending'-Zeile -- die eigentliche Analyse
 * laeuft ausserhalb von workflow_outbox in einem eigenen Cron-Poll im Worker (siehe
 * createVisionProviderComparisonScanWorkflow, apps/worker/src/workflows.ts), weil dafuer keine
 * echte organization_id/department_id existiert.
 */
export function registerVisionProviderComparisonRoutes(app: FastifyInstance, context: ApiRouteContext): void {
  const { requireAuth, requirePlatformAdmin, supabaseClients } = context

  app.post('/v1/vision-provider-comparisons', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    if (!(await requirePlatformAdmin(request, reply))) return
    const input = CreateVisionProviderComparisonRunRequestSchema.parse(request.body)
    // Dieselbe Vorabpruefung wie beim echten Marken-Crawl (routes/brand.ts): der Worker rendert
    // genau diese URL mit einem echten Browser, eine vom CHECK abgelehnte Adresse waere sonst eine
    // 500 statt einer verstaendlichen 400.
    if (!isAllowedOutboundUrl(input.websiteUrl)) {
      return reply.code(400).send({ error: 'website_url_not_allowed', correlationId: request.id })
    }
    const service = supabaseClients.forService()
    const insert = await service
      .from('vision_provider_comparison_runs')
      .insert({ website_url: input.websiteUrl, requested_by: request.auth!.userId })
      .select(RUN_COLUMNS)
      .single()
    if (insert.error) throw insert.error
    return reply.code(202).send(await mapVisionProviderComparisonRunRow(service, insert.data))
  })

  app.get('/v1/vision-provider-comparisons', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    if (!(await requirePlatformAdmin(request, reply))) return
    const service = supabaseClients.forService()
    // 20 reicht fuer ein Testwerkzeug, das ein einzelner Plattform-Admin ad-hoc bedient -- keine
    // Paginierung fuer eine Liste, die nie in die Hunderte waechst.
    const rows = await service.from('vision_provider_comparison_runs').select(RUN_COLUMNS).order('created_at', { ascending: false }).limit(20)
    if (rows.error) throw rows.error
    return reply.code(200).send(await Promise.all(rows.data.map((row) => mapVisionProviderComparisonRunRow(service, row))))
  })

  app.get('/v1/vision-provider-comparisons/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    if (!(await requirePlatformAdmin(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const service = supabaseClients.forService()
    const row = await service.from('vision_provider_comparison_runs').select(RUN_COLUMNS).eq('id', params.id).maybeSingle()
    if (row.error) throw row.error
    if (!row.data) return reply.code(404).send({ error: 'vision_provider_comparison_not_found', correlationId: request.id })
    return reply.code(200).send(await mapVisionProviderComparisonRunRow(service, row.data))
  })
}
