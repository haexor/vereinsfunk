import { ContentLimitOverrideSchema, CreateSubscriptionPlanRequestSchema, OrganizationSubscriptionSchema, PlatformAdminOrganizationSubscriptionSchema, SetContentLimitOverrideRequestSchema, SetOrganizationSubscriptionRequestSchema, SetSubscriptionPlanContentLimitsRequestSchema, SubscriptionPlanContentLimitSchema, SubscriptionPlanSchema, UpdateSubscriptionPlanRequestSchema, UuidSchema } from '@vereinsfunk/contracts'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ApiRouteContext } from './context.js'
import { createAuditRecorder } from './shared.js'
import { parseBlockingPublications } from '../moduleStatus.js'

// Dieselben zwoelf Felder wurden bislang an drei Stellen (Liste, Anlegen, Aendern) einzeln
// zusammengebaut -- ein neues Tariffeld haette an einer der drei Stellen vergessen werden koennen,
// ohne dass SubscriptionPlanSchema.parse() das erkennen wuerde (es prueft die Form, nicht ob eine
// Stelle ein Feld unterschlaegt). Jetzt eine Zuordnung.
function toSubscriptionPlanDto(
  row: { key: string; display_name: string; monthly_price_cents: number | null; currency: string; storage_bytes: number; max_teams: number | null; max_departments: number | null; is_self_serviceable: boolean; sort_order: number; available_from: string | null; available_until: string | null; included_modules: string[] },
  contentLimits: readonly { media_origin: string; max_per_month: number | null; max_duration_seconds: number | null }[],
) {
  return SubscriptionPlanSchema.parse({
    key: row.key, displayName: row.display_name, monthlyPriceCents: row.monthly_price_cents, currency: row.currency,
    storageBytes: row.storage_bytes, maxTeams: row.max_teams, maxDepartments: row.max_departments,
    isSelfServiceable: row.is_self_serviceable, sortOrder: row.sort_order, availableFrom: row.available_from, availableUntil: row.available_until,
    includedModules: row.included_modules,
    contentLimits: contentLimits.map((limit) => ({ mediaOrigin: limit.media_origin, maxPerMonth: limit.max_per_month, maxDurationSeconds: limit.max_duration_seconds })),
  })
}

export function registerPlatformSubscriptionRoutes(app: FastifyInstance, context: ApiRouteContext): void {
  const { requireAuth, requirePlatformAdmin, supabaseClients } = context
  const recordAuditEvent = createAuditRecorder(supabaseClients)

  // --- Plan 021: Tarife selbst anlegen und pflegen, statt nur per Migration-Seed ------------------
  app.get('/v1/platform-admin/subscription-plans', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    if (!(await requirePlatformAdmin(request, reply))) return
    const service = supabaseClients.forService()
    const plans = await service
      .from('subscription_plans')
      .select('key, display_name, monthly_price_cents, currency, storage_bytes, max_teams, max_departments, is_self_serviceable, sort_order, available_from, available_until, included_modules')
      .order('sort_order')
    if (plans.error) throw plans.error
    const contentLimits = await service.from('subscription_plan_content_limits').select('plan_key, media_origin, max_per_month, max_duration_seconds')
    if (contentLimits.error) throw contentLimits.error
    return reply.code(200).send(
      plans.data.map((row) => toSubscriptionPlanDto(row, contentLimits.data.filter((limit) => limit.plan_key === row.key))),
    )
  })

  app.post('/v1/platform-admin/subscription-plans', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    if (!(await requirePlatformAdmin(request, reply))) return
    const input = CreateSubscriptionPlanRequestSchema.parse(request.body)
    const service = supabaseClients.forService()
    const insert = await service
      .from('subscription_plans')
      .insert({
        key: input.key, display_name: input.displayName, monthly_price_cents: input.monthlyPriceCents, currency: input.currency,
        storage_bytes: input.storageBytes, max_teams: input.maxTeams, max_departments: input.maxDepartments,
        is_self_serviceable: input.isSelfServiceable, sort_order: input.sortOrder, available_from: input.availableFrom, available_until: input.availableUntil,
        included_modules: input.includedModules,
      })
      .select('key')
      .single()
    if (insert.error) {
      if (insert.error.code === '23505') return reply.code(409).send({ error: 'plan_already_exists', correlationId: request.id })
      throw insert.error
    }
    const limitsInsert = await service
      .from('subscription_plan_content_limits')
      .insert(input.contentLimits.map((limit) => ({ plan_key: input.key, media_origin: limit.mediaOrigin, max_per_month: limit.maxPerMonth, max_duration_seconds: limit.maxDurationSeconds })))
    if (limitsInsert.error) {
      // Ohne Rollback bliebe ein Tarif ohne jedes Kontingent zurueck -- dasselbe Muster wie beim
      // LLM-Provider-Geheimnis in llmProviders.routes.ts. Der Rollback-delete wird selbst geprueft
      // und geloggt: schlaegt er ebenfalls fehl, bliebe sonst ein verwaister Tarif ohne jedes
      // Signal fuer manuelles Aufraeumen zurueck (beim eigenen Review gefunden).
      const rollback = await service.from('subscription_plans').delete().eq('key', input.key)
      if (rollback.error) request.log.error({ err: rollback.error, correlationId: request.id, planKey: input.key }, 'rollback of orphaned subscription plan failed')
      throw limitsInsert.error
    }
    return reply.code(201).send(toSubscriptionPlanDto(
      { key: input.key, display_name: input.displayName, monthly_price_cents: input.monthlyPriceCents, currency: input.currency, storage_bytes: input.storageBytes, max_teams: input.maxTeams, max_departments: input.maxDepartments, is_self_serviceable: input.isSelfServiceable, sort_order: input.sortOrder, available_from: input.availableFrom, available_until: input.availableUntil, included_modules: [...input.includedModules] },
      input.contentLimits.map((limit) => ({ media_origin: limit.mediaOrigin, max_per_month: limit.maxPerMonth, max_duration_seconds: limit.maxDurationSeconds })),
    ))
  })

  app.patch('/v1/platform-admin/subscription-plans/:key', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    if (!(await requirePlatformAdmin(request, reply))) return
    const params = z.object({ key: z.string().regex(/^[a-z][a-z0-9_]*$/) }).parse(request.params)
    const input = UpdateSubscriptionPlanRequestSchema.parse(request.body)
    const service = supabaseClients.forService()
    const payload: Record<string, unknown> = {}
    if (input.displayName !== undefined) payload.display_name = input.displayName
    if (input.monthlyPriceCents !== undefined) payload.monthly_price_cents = input.monthlyPriceCents
    if (input.currency !== undefined) payload.currency = input.currency
    if (input.storageBytes !== undefined) payload.storage_bytes = input.storageBytes
    if (input.maxTeams !== undefined) payload.max_teams = input.maxTeams
    if (input.maxDepartments !== undefined) payload.max_departments = input.maxDepartments
    if (input.isSelfServiceable !== undefined) payload.is_self_serviceable = input.isSelfServiceable
    if (input.sortOrder !== undefined) payload.sort_order = input.sortOrder
    if (input.availableFrom !== undefined) payload.available_from = input.availableFrom
    if (input.availableUntil !== undefined) payload.available_until = input.availableUntil
    if (input.includedModules !== undefined) payload.included_modules = input.includedModules
    const update = await service.rpc('update_subscription_plan', { target_plan_key: params.key, target_patch: payload })
    if (update.error) {
      if (update.error.message.includes('plan_not_found')) return reply.code(404).send({ error: 'plan_not_found', correlationId: request.id })
      if (update.error.message.includes('module_has_active_publications')) {
        return reply.code(409).send({ error: 'module_has_active_publications', publications: parseBlockingPublications(update.error.details), correlationId: request.id })
      }
      throw update.error
    }
    if (!update.data) return reply.code(404).send({ error: 'plan_not_found', correlationId: request.id })
    const contentLimits = await service.from('subscription_plan_content_limits').select('media_origin, max_per_month, max_duration_seconds').eq('plan_key', params.key)
    if (contentLimits.error) throw contentLimits.error
    return reply.code(200).send(toSubscriptionPlanDto(update.data, contentLimits.data))
  })

  app.put('/v1/platform-admin/subscription-plans/:key/content-limits', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    if (!(await requirePlatformAdmin(request, reply))) return
    const params = z.object({ key: z.string().regex(/^[a-z][a-z0-9_]*$/) }).parse(request.params)
    const input = SetSubscriptionPlanContentLimitsRequestSchema.parse(request.body)
    const service = supabaseClients.forService()
    const plan = await service.from('subscription_plans').select('key').eq('key', params.key).maybeSingle()
    if (plan.error) throw plan.error
    if (!plan.data) return reply.code(404).send({ error: 'plan_not_found', correlationId: request.id })
    // set_subscription_plan_content_limits() ersetzt delete()+insert() ueber zwei getrennte
    // PostgREST-Aufrufe durch eine Transaktion (Migration 2026081303) -- ein fehlschlagender insert
    // nach erfolgreichem delete liess sonst einen Tarif ohne jedes Kontingent zurueck (beim eigenen
    // Review gefunden). Eine im Request fehlende Herkunftsart wird dadurch zu 0 (fehlende Zeile),
    // nicht stillschweigend beibehalten (siehe Datenmodell: "null loescht die Zeile explizit statt
    // sie stillschweigend auf unbegrenzt zu setzen").
    const result = await service.rpc('set_subscription_plan_content_limits', {
      target_plan_key: params.key,
      target_limits: input.contentLimits.map((limit) => ({ mediaOrigin: limit.mediaOrigin, maxPerMonth: limit.maxPerMonth, maxDurationSeconds: limit.maxDurationSeconds })),
    })
    if (result.error) throw result.error
    return reply.code(200).send({ contentLimits: (result.data as { media_origin: string; max_per_month: number | null; max_duration_seconds: number | null }[]).map((limit) => SubscriptionPlanContentLimitSchema.parse({ mediaOrigin: limit.media_origin, maxPerMonth: limit.max_per_month, maxDurationSeconds: limit.max_duration_seconds })) })
  })

  // Lesestelle fuer den aktuellen Tarifstand eines Vereins -- PR 2 brachte nur die beiden
  // PUT-Endpunkte zum Setzen, die Vereinsdetailseite (PR 3) braucht aber eine Ansicht des
  // Bestehenden, bevor sie es ueberschreibt (im Ausfuehrungsplan fehlte dieses GET-Gegenstueck).
  app.get('/v1/platform-admin/organizations/:organizationId/subscription', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    if (!(await requirePlatformAdmin(request, reply))) return
    const params = z.object({ organizationId: UuidSchema }).parse(request.params)
    const service = supabaseClients.forService()
    const subscription = await service
      .from('organization_subscriptions')
      .select('organization_id, plan_key, status, storage_bytes_override, max_teams_override, max_departments_override, override_reason')
      .eq('organization_id', params.organizationId)
      .maybeSingle()
    if (subscription.error) throw subscription.error
    if (!subscription.data) return reply.code(404).send({ error: 'subscription_not_found', correlationId: request.id })
    const [plan, effectiveLimits, contentLimitOverrides] = await Promise.all([
      service.from('subscription_plans').select('display_name').eq('key', subscription.data.plan_key).single(),
      service.rpc('effective_limits', { target: params.organizationId }),
      service.from('organization_content_limit_overrides').select('media_origin, max_per_month, max_duration_seconds, override_reason').eq('organization_id', params.organizationId),
    ])
    if (plan.error) throw plan.error
    if (effectiveLimits.error) throw effectiveLimits.error
    if (contentLimitOverrides.error) throw contentLimitOverrides.error
    const limitsRow = effectiveLimits.data[0] as { storage_bytes: number; max_teams: number | null; max_departments: number | null }
    return reply.code(200).send(PlatformAdminOrganizationSubscriptionSchema.parse({
      organizationId: subscription.data.organization_id, planKey: subscription.data.plan_key, planDisplayName: plan.data.display_name, status: subscription.data.status,
      storageBytesOverride: subscription.data.storage_bytes_override, maxTeamsOverride: subscription.data.max_teams_override, maxDepartmentsOverride: subscription.data.max_departments_override,
      overrideReason: subscription.data.override_reason,
      effectiveLimits: { storageBytes: limitsRow.storage_bytes, maxTeams: limitsRow.max_teams, maxDepartments: limitsRow.max_departments },
      contentLimitOverrides: contentLimitOverrides.data.map((row) => ({
        mediaOrigin: row.media_origin, maxPerMonth: row.max_per_month, maxDurationSeconds: row.max_duration_seconds, overrideReason: row.override_reason,
      })),
    }))
  })

  app.put('/v1/platform-admin/organizations/:organizationId/subscription', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    if (!(await requirePlatformAdmin(request, reply))) return
    const params = z.object({ organizationId: UuidSchema }).parse(request.params)
    const input = SetOrganizationSubscriptionRequestSchema.parse(request.body)
    const service = supabaseClients.forService()
    const plan = await service.from('subscription_plans').select('key').eq('key', input.planKey).maybeSingle()
    if (plan.error) throw plan.error
    if (!plan.data) return reply.code(404).send({ error: 'plan_not_found', correlationId: request.id })
    const hasOverride = input.storageBytesOverride !== null || input.maxTeamsOverride !== null || input.maxDepartmentsOverride !== null
    const upsert = await service
      .from('organization_subscriptions')
      .upsert(
        {
          organization_id: params.organizationId, plan_key: input.planKey,
          storage_bytes_override: input.storageBytesOverride, max_teams_override: input.maxTeamsOverride, max_departments_override: input.maxDepartmentsOverride,
          override_reason: hasOverride ? input.overrideReason : null, override_by: hasOverride ? request.auth!.userId : null, override_at: hasOverride ? new Date().toISOString() : null,
        },
        { onConflict: 'organization_id' },
      )
      .select('organization_id, plan_key, status, storage_bytes_override, max_teams_override, max_departments_override, override_reason')
      .single()
    if (upsert.error) {
      if (upsert.error.code === '23503') return reply.code(404).send({ error: 'organization_not_found', correlationId: request.id })
      // Paket 051: Trigger organization_subscriptions_module_guard -- der neue Tarif nimmt dem
      // Verein social_media, waehrend noch Veroeffentlichungen aktiv sind.
      if (upsert.error.message.includes('module_has_active_publications')) {
        return reply.code(409).send({ error: 'module_has_active_publications', publications: parseBlockingPublications(upsert.error.details), correlationId: request.id })
      }
      throw upsert.error
    }
    await recordAuditEvent(request, {
      organizationId: params.organizationId, action: 'subscription.overridden', entityType: 'organization_subscriptions', entityId: params.organizationId,
      metadata: { planKey: input.planKey, hasOverride },
    })
    return reply.code(200).send(OrganizationSubscriptionSchema.parse({
      organizationId: upsert.data.organization_id, planKey: upsert.data.plan_key, status: upsert.data.status,
      storageBytesOverride: upsert.data.storage_bytes_override, maxTeamsOverride: upsert.data.max_teams_override, maxDepartmentsOverride: upsert.data.max_departments_override,
      overrideReason: upsert.data.override_reason,
    }))
  })

  app.put('/v1/platform-admin/organizations/:organizationId/content-limit-overrides', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    if (!(await requirePlatformAdmin(request, reply))) return
    const params = z.object({ organizationId: UuidSchema }).parse(request.params)
    const input = SetContentLimitOverrideRequestSchema.parse(request.body)
    const service = supabaseClients.forService()
    const upsert = await service
      .from('organization_content_limit_overrides')
      .upsert(
        {
          organization_id: params.organizationId, media_origin: input.mediaOrigin, max_per_month: input.maxPerMonth, max_duration_seconds: input.maxDurationSeconds,
          override_reason: input.overrideReason, override_by: request.auth!.userId, override_at: new Date().toISOString(),
        },
        { onConflict: 'organization_id,media_origin' },
      )
      .select('media_origin, max_per_month, max_duration_seconds, override_reason')
      .single()
    if (upsert.error) {
      if (upsert.error.code === '23503') return reply.code(404).send({ error: 'organization_not_found', correlationId: request.id })
      throw upsert.error
    }
    await recordAuditEvent(request, {
      organizationId: params.organizationId, action: 'content_limit_override.set', entityType: 'organization_content_limit_overrides', entityId: params.organizationId,
      metadata: { mediaOrigin: input.mediaOrigin, maxPerMonth: input.maxPerMonth, maxDurationSeconds: input.maxDurationSeconds },
    })
    return reply.code(200).send(ContentLimitOverrideSchema.parse({
      mediaOrigin: upsert.data.media_origin, maxPerMonth: upsert.data.max_per_month, maxDurationSeconds: upsert.data.max_duration_seconds, overrideReason: upsert.data.override_reason,
    }))
  })
}
