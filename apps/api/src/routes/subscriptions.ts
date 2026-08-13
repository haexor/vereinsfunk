import {
  ChangeSubscriptionPlanRequestSchema,
  PublicationsUsageResponseSchema,
  SetStorageLimitRequestSchema,
  StorageLimitSchema,
  StorageUsageQuerySchema,
  StorageUsageResponseSchema,
  SubscriptionPlanSchema,
  SubscriptionSummarySchema,
  UuidSchema,
  type MediaOrigin,
} from '@vereinsfunk/contracts'
import { hasPermission } from '@vereinsfunk/authorization'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ApiRouteContext } from './context.js'
import { createAuditRecorder, isAnyMemberOfOrganization, POLICY_MANAGE_PERMISSION, resolveMembershipScope } from './shared.js'

async function loadEffectiveLimits(service: SupabaseClient, organizationId: string) {
  const result = await service.rpc('effective_limits', { target: organizationId })
  if (result.error) throw result.error
  const row = result.data[0] as { storage_bytes: number; max_teams: number | null; max_departments: number | null } | undefined
  return row ?? null
}

async function loadEffectiveContentLimits(service: SupabaseClient, organizationId: string) {
  const result = await service.rpc('effective_content_limits', { target: organizationId })
  if (result.error) throw result.error
  return result.data as { media_origin: MediaOrigin; max_per_month: number | null; max_duration_seconds: number | null }[]
}

async function loadContentQuotaUsage(service: SupabaseClient, organizationId: string) {
  const contentLimits = await loadEffectiveContentLimits(service, organizationId)
  const now = new Date().toISOString()
  const usageByOrigin = new Map(
    await Promise.all(
      contentLimits.map(async (row) => {
        const count = await service.rpc('count_publications_in_period', {
          target_organization: organizationId, target_department: null, target_team: null, target_connection: null,
          quota_period: 'month', reference: now, target_media_origin: row.media_origin,
        })
        if (count.error) throw count.error
        return [row.media_origin, count.data as number] as const
      }),
    ),
  )
  return contentLimits.map((row) => ({
    mediaOrigin: row.media_origin,
    maxPerMonth: row.max_per_month,
    maxDurationSeconds: row.max_duration_seconds,
    used: usageByOrigin.get(row.media_origin) ?? 0,
  }))
}

export function registerSubscriptionRoutes(app: FastifyInstance, context: ApiRouteContext): void {
  const { requireAuth, requirePermission, roleProvider, supabaseClients } = context
  const recordAuditEvent = createAuditRecorder(supabaseClients)

  app.get('/v1/subscription', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const query = z.object({ organizationId: UuidSchema }).parse(request.query)
    // organization.manage ODER billing.manage duerfen den eigenen Tarif einsehen --
    // requirePermission kennt nur eine einzelne Berechtigung, deshalb hier von Hand.
    const roles = await roleProvider.rolesForScope(request.auth!, { organizationId: query.organizationId })
    if (!hasPermission(roles, 'organization.manage') && !hasPermission(roles, 'billing.manage')) {
      return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
    }
    const service = supabaseClients.forService()
    const subscription = await service
      .from('organization_subscriptions')
      .select('plan_key, status, storage_bytes_override, max_teams_override, max_departments_override')
      .eq('organization_id', query.organizationId)
      .maybeSingle()
    if (subscription.error) throw subscription.error
    if (!subscription.data) return reply.code(404).send({ error: 'subscription_not_found', correlationId: request.id })
    const plan = await service
      .from('subscription_plans')
      .select('key, display_name, monthly_price_cents, currency')
      .eq('key', subscription.data.plan_key)
      .single()
    if (plan.error) throw plan.error
    const limits = await loadEffectiveLimits(service, query.organizationId)
    if (!limits) return reply.code(404).send({ error: 'subscription_not_found', correlationId: request.id })
    const [storageUsage, departments, teams, contentQuotas] = await Promise.all([
      service.rpc('storage_usage_bytes', { target_organization: query.organizationId, target_department: null, target_team: null }),
      service.from('departments').select('*', { count: 'exact', head: true }).eq('organization_id', query.organizationId).is('archived_at', null),
      service.from('teams').select('*', { count: 'exact', head: true }).eq('organization_id', query.organizationId).is('archived_at', null),
      loadContentQuotaUsage(service, query.organizationId),
    ])
    if (storageUsage.error) throw storageUsage.error
    if (departments.error) throw departments.error
    if (teams.error) throw teams.error
    return reply.code(200).send(SubscriptionSummarySchema.parse({
      plan: { key: plan.data.key, displayName: plan.data.display_name, monthlyPriceCents: plan.data.monthly_price_cents, currency: plan.data.currency },
      status: subscription.data.status,
      limits: { storageBytes: limits.storage_bytes, maxTeams: limits.max_teams, maxDepartments: limits.max_departments },
      isStorageOverridden: subscription.data.storage_bytes_override !== null,
      isStructureOverridden: subscription.data.max_teams_override !== null || subscription.data.max_departments_override !== null,
      usage: { storageBytes: storageUsage.data as number, departments: departments.count ?? 0, teams: teams.count ?? 0 },
      contentQuotas,
    }))
  })

  app.get('/v1/subscription/plans', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const service = supabaseClients.forService()
    const today = new Date().toISOString().slice(0, 10)
    const plans = await service
      .from('subscription_plans')
      .select('key, display_name, monthly_price_cents, currency, storage_bytes, max_teams, max_departments, is_self_serviceable, sort_order, available_from, available_until')
      .eq('is_self_serviceable', true)
      .or(`available_from.is.null,available_from.lte.${today}`)
      .or(`available_until.is.null,available_until.gte.${today}`)
      .order('sort_order')
    if (plans.error) throw plans.error
    const contentLimits = await service
      .from('subscription_plan_content_limits')
      .select('plan_key, media_origin, max_per_month, max_duration_seconds')
      .in('plan_key', plans.data.map((row) => row.key))
    if (contentLimits.error) throw contentLimits.error
    return reply.code(200).send(
      plans.data.map((row) =>
        SubscriptionPlanSchema.parse({
          key: row.key, displayName: row.display_name, monthlyPriceCents: row.monthly_price_cents, currency: row.currency,
          storageBytes: row.storage_bytes, maxTeams: row.max_teams, maxDepartments: row.max_departments,
          isSelfServiceable: row.is_self_serviceable, sortOrder: row.sort_order, availableFrom: row.available_from, availableUntil: row.available_until,
          contentLimits: contentLimits.data
            .filter((limit) => limit.plan_key === row.key)
            .map((limit) => ({ mediaOrigin: limit.media_origin, maxPerMonth: limit.max_per_month, maxDurationSeconds: limit.max_duration_seconds })),
        }),
      ),
    )
  })

  app.post('/v1/subscription/plan', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const body = ChangeSubscriptionPlanRequestSchema.extend({ organizationId: UuidSchema }).parse(request.body)
    if (!(await requirePermission(request, reply, 'billing.manage', { organizationId: body.organizationId }))) return
    const service = supabaseClients.forService()
    const today = new Date().toISOString().slice(0, 10)
    // Dieselbe Buchbarkeitsregel wie GET /v1/subscription/plans -- ohne sie liesse sich ein
    // individuell vereinbarter (is_self_serviceable=false) oder gerade nicht verfuegbarer Tarif per
    // direktem Aufruf umgehen, obwohl er in der Auswahlliste gar nicht erscheint (beim eigenen
    // Review gefunden: der Wechsel-Endpunkt pruefte bisher nur "existiert der Schluessel").
    const target = await service
      .from('subscription_plans')
      .select('key')
      .eq('key', body.planKey)
      .eq('is_self_serviceable', true)
      .or(`available_from.is.null,available_from.lte.${today}`)
      .or(`available_until.is.null,available_until.gte.${today}`)
      .maybeSingle()
    if (target.error) throw target.error
    if (!target.data) return reply.code(404).send({ error: 'plan_not_found', correlationId: request.id })
    const previous = await service.from('organization_subscriptions').select('plan_key').eq('organization_id', body.organizationId).maybeSingle()
    if (previous.error) throw previous.error
    const update = await service.from('organization_subscriptions').update({ plan_key: body.planKey }).eq('organization_id', body.organizationId).select('organization_id').maybeSingle()
    if (update.error) throw update.error
    if (!update.data) return reply.code(404).send({ error: 'subscription_not_found', correlationId: request.id })
    await recordAuditEvent(request, {
      organizationId: body.organizationId, action: 'subscription.plan_changed', entityType: 'organization_subscriptions', entityId: body.organizationId,
      metadata: { fromPlanKey: previous.data?.plan_key ?? null, toPlanKey: body.planKey },
    })
    return reply.code(204).send()
  })

  app.put('/v1/organizations/:id/storage-limits', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = SetStorageLimitRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const scope = await resolveMembershipScope(client, input.scope, input.scopeId)
    if (!scope || scope.organizationId !== params.id) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    // department.manage fuer eine Abteilungsgrenze, team.manage fuer eine Mannschaftsgrenze --
    // dieselbe Zuordnung wie bei Richtlinien und channel_quotas (POLICY_MANAGE_PERMISSION), nicht
    // hartkodiert 'department.manage' fuer beide Faelle. Ein team_manager (haelt team.manage,
    // nicht department.manage) waere sonst von der storage_limits_insert-RLS-Policy her berechtigt
    // gewesen, an der API-Pruefung aber immer gescheitert (beim eigenen Review gefunden).
    if (!(await requirePermission(request, reply, POLICY_MANAGE_PERMISSION[input.scope], scope))) return
    // storage_limits_unique normalisiert team_id per coalesce() auf eine Sentinel-UUID (siehe
    // Migration) -- ein Ausdrucks-Index, den PostgREST-Upsert nicht als onConflict-Ziel
    // referenzieren kann. Deshalb hier von Hand nachschlagen und dann update-oder-insert, statt
    // upsert(): dieselbe Select-dann-Schreiben-Logik wie set_policy_setting.
    let existingQuery = client.from('storage_limits').select('id').eq('organization_id', params.id).eq('scope', input.scope).eq('department_id', scope.departmentId!)
    existingQuery = scope.teamId ? existingQuery.eq('team_id', scope.teamId) : existingQuery.is('team_id', null)
    const existing = await existingQuery.maybeSingle()
    if (existing.error) throw existing.error
    const result = existing.data
      ? await client.from('storage_limits').update({ storage_bytes: input.storageBytes, set_by: request.auth!.userId }).eq('id', existing.data.id).select('id, scope, department_id, team_id, storage_bytes').single()
      : await client
          .from('storage_limits')
          .insert({
            organization_id: params.id, scope: input.scope, department_id: scope.departmentId ?? null, team_id: scope.teamId ?? null,
            storage_bytes: input.storageBytes, set_by: request.auth!.userId,
          })
          .select('id, scope, department_id, team_id, storage_bytes')
          .single()
    if (result.error) {
      if (result.error.code === '23505') return reply.code(409).send({ error: 'storage_limit_already_exists', correlationId: request.id })
      throw result.error
    }
    return reply.code(200).send(
      StorageLimitSchema.parse({
        id: result.data.id, scope: result.data.scope, scopeId: result.data.team_id ?? result.data.department_id, storageBytes: result.data.storage_bytes,
      }),
    )
  })

  app.get('/v1/storage/usage', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const query = StorageUsageQuerySchema.parse(request.query)
    if (!(await isAnyMemberOfOrganization(supabaseClients.forUser(request.auth!.accessToken), request.auth!.userId, query.organizationId))) {
      return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
    }
    const service = supabaseClients.forService()
    const targetDepartment = query.departmentId ?? null
    const targetTeam = query.teamId ?? null
    const [usage, breakdown] = await Promise.all([
      service.rpc('storage_usage_bytes', { target_organization: query.organizationId, target_department: targetDepartment, target_team: targetTeam }),
      service.rpc('storage_usage_breakdown', { target_organization: query.organizationId, target_department: targetDepartment, target_team: targetTeam }),
    ])
    if (usage.error) throw usage.error
    if (breakdown.error) throw breakdown.error
    const breakdownRow = breakdown.data[0] as { own_uploads: number; rendered_media: number; brand_assets: number }
    let limitBytes: number | null
    if (targetTeam || targetDepartment) {
      // team_id ist in storage_limits nur bei scope='team' gesetzt -- ueber team_id allein
      // eindeutig, ein zusaetzlicher department_id-Filter waere redundant und muesste sonst
      // .is('team_id', null) fuer den Abteilungsfall gesondert behandeln.
      let limitQuery = service.from('storage_limits').select('storage_bytes').eq('organization_id', query.organizationId)
      limitQuery = targetTeam ? limitQuery.eq('scope', 'team').eq('team_id', targetTeam) : limitQuery.eq('scope', 'department').eq('department_id', targetDepartment as string).is('team_id', null)
      const limitRow = await limitQuery.maybeSingle()
      if (limitRow.error) throw limitRow.error
      limitBytes = (limitRow.data?.storage_bytes as number | undefined) ?? null
    } else {
      const limits = await loadEffectiveLimits(service, query.organizationId)
      limitBytes = limits?.storage_bytes ?? null
    }
    return reply.code(200).send(StorageUsageResponseSchema.parse({
      usedBytes: usage.data as number,
      limitBytes,
      breakdown: { ownUploads: breakdownRow.own_uploads, renderedMedia: breakdownRow.rendered_media, brandAssets: breakdownRow.brand_assets },
    }))
  })

  app.get('/v1/publications/usage', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const query = z.object({ organizationId: UuidSchema }).parse(request.query)
    if (!(await isAnyMemberOfOrganization(supabaseClients.forUser(request.auth!.accessToken), request.auth!.userId, query.organizationId))) {
      return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
    }
    const service = supabaseClients.forService()
    const quotas = await loadContentQuotaUsage(service, query.organizationId)
    return reply.code(200).send(PublicationsUsageResponseSchema.parse({ quotas }))
  })
}
