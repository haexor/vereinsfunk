import {
  PlatformAdminOrganizationDetailSchema,
  PlatformAdminOrganizationSummarySchema,
  UsageMetricsQuerySchema,
  UsageMetricsResponseSchema,
  UuidSchema,
} from '@vereinsfunk/contracts'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ApiRouteContext } from './context.js'
import { fetchAllRows, notExpiredFilter } from '../supabase.js'
import { currentPeriodStarts } from '../calendarPeriods.js'

export function registerPlatformOrganizationRoutes(app: FastifyInstance, context: ApiRouteContext): void {
  const { requireAuth, requirePlatformAdmin, supabaseClients } = context

  app.get('/v1/platform-admin/organizations', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    if (!(await requirePlatformAdmin(request, reply))) return
    const service = supabaseClients.forService()
    // Ueber fetchAllRows: die Liste selbst unterliegt demselben max_rows=1000 wie jede andere
    // ungefilterte Abfrage -- ab der 1001. Organisation fehlten Vereine in der Plattformuebersicht
    // stillschweigend, ohne dass die Antwort das erkennen liesse. Sekundaersortierung nach id,
    // damit die Seiten die Tabelle genau einmal kacheln (created_at ist nicht eindeutig).
    const orgRows = await fetchAllRows<{ id: string; name: string; slug: string; created_at: string }>((from, to) =>
      service.from('organizations').select('id, name, slug, created_at').order('created_at', { ascending: false }).order('id', { ascending: true }).range(from, to),
    )
    // Eine gebuendelte RPC statt zweier count-Abfragen je Organisation (N+1,
    // count_platform_admin_organization_totals, Migration 2026081208) -- dasselbe Muster wie die
    // Kontingentauslastung in GET /v1/analytics/summary.
    const totals = await fetchAllRows<{ organization_id: string; member_count: number; department_count: number }>((from, to) =>
      service.rpc('count_platform_admin_organization_totals', { target_organization_ids: orgRows.map((row) => row.id) }).order('organization_id', { ascending: true }).range(from, to),
    )
    const totalsByOrganization = new Map(totals.map((row) => [row.organization_id, row]))
    return reply.code(200).send(
      orgRows.map((row) => {
        const total = totalsByOrganization.get(row.id)
        return PlatformAdminOrganizationSummarySchema.parse({
          organizationId: row.id,
          name: row.name,
          slug: row.slug,
          memberCount: total?.member_count ?? 0,
          departmentCount: total?.department_count ?? 0,
          createdAt: row.created_at,
        })
      }),
    )
  })

  app.get('/v1/platform-admin/organizations/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    if (!(await requirePlatformAdmin(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const service = supabaseClients.forService()

    // Die Kontaktdaten stammen aus dem Vereinsprofil. Zusaetzlich wird die E-Mail
    // eines aktiven Vereinsinhabers separat ausgewiesen: Jeder Verein wird durch
    // ein Supabase-Konto angelegt, dessen Login-Adresse sonst bei einem noch leeren
    // Vereinsprofil fuer die Plattform-Administration nicht sichtbar waere.
    // auth.users wird ausschliesslich ueber den Service-Role-Client und hinter
    // requirePlatformAdmin gelesen.
    const organization = await service
      .from('organizations')
      .select('id, name, slug, timezone, created_at')
      .eq('id', params.id)
      .maybeSingle()
    if (organization.error) throw organization.error
    if (!organization.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })

    const profileResult = await service
      .from('organization_profiles')
      .select('legal_name, street, house_number, postal_code, city, country_code, contact_email, contact_phone, website_url, responsible_person_profile_id')
      .eq('organization_id', params.id)
      .maybeSingle()
    if (profileResult.error) throw profileResult.error
    const profile = profileResult.data

    const ownerMembership = await service
      .from('organization_memberships')
      .select('user_id')
      .eq('organization_id', params.id)
      .eq('role', 'organization_owner')
      .or(notExpiredFilter())
      .order('created_at')
      .limit(1)
      .maybeSingle()
    if (ownerMembership.error) throw ownerMembership.error

    let ownerAccountEmail: string | null = null
    if (ownerMembership.data?.user_id) {
      const owner = await service.auth.admin.getUserById(ownerMembership.data.user_id as string)
      if (owner.error) throw owner.error
      ownerAccountEmail = owner.data.user?.email ?? null
    }

    let responsiblePersonName: string | null = null
    if (profile?.responsible_person_profile_id) {
      const person = await service
        .from('profiles')
        .select('display_name')
        .eq('id', profile.responsible_person_profile_id as string)
        .maybeSingle()
      if (person.error) throw person.error
      responsiblePersonName = person.data?.display_name ?? null
    }

    const [members, departments, rawMedia, renderedMedia] = await Promise.all([
      service.from('organization_memberships').select('*', { count: 'exact', head: true }).eq('organization_id', params.id),
      service.from('departments').select('*', { count: 'exact', head: true }).eq('organization_id', params.id),
      fetchAllRows<{ byte_size: number }>((from, to) =>
        service.from('media_assets').select('byte_size').eq('organization_id', params.id).neq('upload_status', 'deleted').order('id', { ascending: true }).range(from, to),
      ),
      fetchAllRows<{ byte_size: number }>((from, to) =>
        service.from('media_derivatives').select('byte_size').eq('organization_id', params.id).order('id', { ascending: true }).range(from, to),
      ),
    ])
    if (members.error) throw members.error
    if (departments.error) throw departments.error

    // Eigene Paginierung statt einer ungebundenen select()-Abfrage: auch Speicherwerte
    // grosser Vereine bleiben bei Supabases max_rows-Grenze vollstaendig.
    const sumBytes = (rows: readonly { byte_size: number }[]) => rows.reduce((total, row) => total + row.byte_size, 0)
    const rawMediaBytes = sumBytes(rawMedia)
    const renderedMediaBytes = sumBytes(renderedMedia)

    const periodStarts = currentPeriodStarts(organization.data.timezone as string)
    const activityEntries = await Promise.all(
      Object.entries(periodStarts).map(async ([period, from]) => {
        const [posts, reels, videoAssets] = await Promise.all([
          service.from('posts').select('*', { count: 'exact', head: true }).eq('organization_id', params.id).gte('created_at', from),
          service.from('post_variants').select('*', { count: 'exact', head: true }).eq('organization_id', params.id).eq('format', 'reel').gte('created_at', from),
          service.from('media_assets').select('*', { count: 'exact', head: true }).eq('organization_id', params.id).ilike('mime_type', 'video/%').gte('created_at', from),
        ])
        if (posts.error) throw posts.error
        if (reels.error) throw reels.error
        if (videoAssets.error) throw videoAssets.error
        return [period, { posts: posts.count ?? 0, reels: reels.count ?? 0, videoAssets: videoAssets.count ?? 0 }] as const
      }),
    )
    const activity = Object.fromEntries(activityEntries)

    return reply.code(200).send(PlatformAdminOrganizationDetailSchema.parse({
      organizationId: organization.data.id,
      name: organization.data.name,
      slug: organization.data.slug,
      timezone: organization.data.timezone,
      createdAt: organization.data.created_at,
      memberCount: members.count ?? 0,
      departmentCount: departments.count ?? 0,
      contact: {
        responsiblePersonName,
        ownerAccountEmail,
        email: profile?.contact_email ?? null,
        phone: profile?.contact_phone ?? null,
        legalName: profile?.legal_name ?? null,
        street: profile?.street ?? null,
        houseNumber: profile?.house_number ?? null,
        postalCode: profile?.postal_code ?? null,
        city: profile?.city ?? null,
        countryCode: profile?.country_code ?? 'DE',
        websiteUrl: profile?.website_url ?? null,
      },
      storage: { rawMediaBytes, renderedMediaBytes, totalMediaBytes: rawMediaBytes + renderedMediaBytes },
      activity,
    }))
  })

  app.get('/v1/platform-admin/usage-metrics', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    if (!(await requirePlatformAdmin(request, reply))) return
    const query = UsageMetricsQuerySchema.parse(request.query)
    const service = supabaseClients.forService()
    // Jede dieser vier Abfragen zaehlt Zeilen ueber einen frei gewaehlten Zeitraum -- ohne
    // Bloetterung schnitt max_rows=1000 sie still ab, und die Plattformkennzahlen meldeten fuer
    // jeden hinreichend aktiven Zeitraum systematisch zu niedrige Werte, ohne das kenntlich zu
    // machen (gefunden im Code-Review). Dieselbe Begruendung wie bei jedem anderen fetchAllRows
    // in dieser Datei.
    const [posts, versions, workflowRuns, publications] = await Promise.all([
      fetchAllRows<{ created_at: string }>((from, to) =>
        service.from('posts').select('created_at').gte('created_at', query.from).lte('created_at', query.to).order('id', { ascending: true }).range(from, to),
      ),
      fetchAllRows<{ created_at: string }>((from, to) =>
        service.from('post_versions').select('created_at').eq('created_by_type', 'llm').gte('created_at', query.from).lte('created_at', query.to).order('id', { ascending: true }).range(from, to),
      ),
      fetchAllRows<{ created_at: string }>((from, to) =>
        service.from('workflow_runs').select('created_at').eq('technical_status', 'failed').gte('created_at', query.from).lte('created_at', query.to).order('id', { ascending: true }).range(from, to),
      ),
      fetchAllRows<{ created_at: string }>((from, to) =>
        service.from('publications').select('created_at').eq('status', 'failed').gte('created_at', query.from).lte('created_at', query.to).order('id', { ascending: true }).range(from, to),
      ),
    ])

    type BucketField = 'postsCreated' | 'llmGeneratedVersions' | 'workflowRunsFailed' | 'publicationsFailed'
    const buckets = new Map<string, Record<BucketField, number>>()
    const bump = (rows: readonly { created_at: string }[], field: BucketField) => {
      for (const row of rows) {
        const date = new Date(row.created_at).toISOString().slice(0, 10)
        const bucket = buckets.get(date) ?? { postsCreated: 0, llmGeneratedVersions: 0, workflowRunsFailed: 0, publicationsFailed: 0 }
        bucket[field] += 1
        buckets.set(date, bucket)
      }
    }
    bump(posts, 'postsCreated')
    bump(versions, 'llmGeneratedVersions')
    bump(workflowRuns, 'workflowRunsFailed')
    bump(publications, 'publicationsFailed')

    const sortedDates = Array.from(buckets.keys()).sort()
    return reply.code(200).send(
      UsageMetricsResponseSchema.parse({ buckets: sortedDates.map((date) => ({ date, ...buckets.get(date)! })) }),
    )
  })
}
