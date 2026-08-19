import {
  AcceptPlatformAdminInvitationRequestSchema,
  AddPlatformAdminRequestSchema,
  ContentLimitOverrideSchema,
  CreateSubscriptionPlanRequestSchema,
  OrganizationSubscriptionSchema,
  PlatformAdminInvitationSchema,
  PlatformAdminOrganizationDetailSchema,
  PlatformAdminOrganizationSubscriptionSchema,
  PlatformAdminOrganizationSummarySchema,
  PlatformAdminSchema,
  PlatformAdminStatusSchema,
  PlatformSettingKeySchema,
  PlatformSettingSchema,
  PlatformSettingValueSchemas,
  PublishingProviderConfigurationSchema,
  PublishingProviderSchema,
  SetContentLimitOverrideRequestSchema,
  SetOrganizationSubscriptionRequestSchema,
  SetSubscriptionPlanContentLimitsRequestSchema,
  SubscriptionPlanContentLimitSchema,
  SubscriptionPlanSchema,
  UpdatePlatformSettingRequestSchema,
  UpdatePublishingProviderConfigurationRequestSchema,
  UpdateSubscriptionPlanRequestSchema,
  UsageMetricsQuerySchema,
  UsageMetricsResponseSchema,
  UuidSchema,
} from '@vereinsfunk/contracts'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { mapPlatformAdminInvitationRow } from '../apiMappers.js'
import { generateInvitationToken, invitationCallbackUrls, sendInvitationThroughSupabaseAuth } from '../invitations.js'
import type { ApiRouteContext } from './context.js'
import { createAuditRecorder, fetchAllRows } from './shared.js'
import { ciphertextToBytea, createSecretBoxFromEnvironment } from '../secretBox.js'

// Analog invitationUrls() in routes/invitations.ts, aber mit dem Annahme-Pfad fuer
// Plattform-Admins statt fuer Vereinsmitglieder.
function platformAdminInvitationUrls(webBaseUrl: string, rawToken: string): { accept: string; setPassword: string } {
  return invitationCallbackUrls(webBaseUrl, `/plattform-admin-einladung?token=${encodeURIComponent(rawToken)}`)
}

// Dieselben zwoelf Felder wurden bislang an drei Stellen (Liste, Anlegen, Aendern) einzeln
// zusammengebaut -- ein neues Tariffeld haette an einer der drei Stellen vergessen werden koennen,
// ohne dass SubscriptionPlanSchema.parse() das erkennen wuerde (es prueft die Form, nicht ob eine
// Stelle ein Feld unterschlaegt). Jetzt eine Zuordnung.
function toSubscriptionPlanDto(
  row: { key: string; display_name: string; monthly_price_cents: number | null; currency: string; storage_bytes: number; max_teams: number | null; max_departments: number | null; is_self_serviceable: boolean; sort_order: number; available_from: string | null; available_until: string | null },
  contentLimits: readonly { media_origin: string; max_per_month: number | null; max_duration_seconds: number | null }[],
) {
  return SubscriptionPlanSchema.parse({
    key: row.key, displayName: row.display_name, monthlyPriceCents: row.monthly_price_cents, currency: row.currency,
    storageBytes: row.storage_bytes, maxTeams: row.max_teams, maxDepartments: row.max_departments,
    isSelfServiceable: row.is_self_serviceable, sortOrder: row.sort_order, availableFrom: row.available_from, availableUntil: row.available_until,
    contentLimits: contentLimits.map((limit) => ({ mediaOrigin: limit.media_origin, maxPerMonth: limit.max_per_month, maxDurationSeconds: limit.max_duration_seconds })),
  })
}

type CalendarDate = { year: number; month: number; day: number }
type CalendarDateTime = CalendarDate & { hour: number; minute: number; second: number }

// Die Aktivitaetsperioden orientieren sich an der Zeitzone des Vereins, nicht an der
// Server-Zeitzone. Damit wechselt der Tageszaehler fuer einen Berliner Verein auch im
// Sommer korrekt um Mitternacht in Berlin. Die iterative Umrechnung behandelt dabei
// unterschiedliche UTC-Offsets (Sommer-/Winterzeit) ohne eine weitere Datumsbibliothek.
function calendarDateTimeInTimeZone(timeZone: string, instant = new Date()): CalendarDateTime {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant)
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value)
  return {
    year: value('year'), month: value('month'), day: value('day'),
    hour: value('hour'), minute: value('minute'), second: value('second'),
  }
}

function calendarDateInTimeZone(timeZone: string, instant = new Date()): CalendarDate {
  const { year, month, day } = calendarDateTimeInTimeZone(timeZone, instant)
  return { year, month, day }
}

function midnightInTimeZone(date: CalendarDate, timeZone: string): string {
  const localMidnight = Date.UTC(date.year, date.month - 1, date.day)
  let instant = localMidnight
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const rendered = calendarDateTimeInTimeZone(timeZone, new Date(instant))
    const renderedAsUtc = Date.UTC(rendered.year, rendered.month - 1, rendered.day, rendered.hour, rendered.minute, rendered.second)
    instant += localMidnight - renderedAsUtc
  }
  return new Date(instant).toISOString()
}

function addCalendarDays(date: CalendarDate, amount: number): CalendarDate {
  const result = new Date(Date.UTC(date.year, date.month - 1, date.day + amount))
  return { year: result.getUTCFullYear(), month: result.getUTCMonth() + 1, day: result.getUTCDate() }
}

function currentPeriodStarts(timeZone: string): Record<'day' | 'week' | 'month' | 'year', string> {
  const today = calendarDateInTimeZone(timeZone)
  const weekday = new Date(Date.UTC(today.year, today.month - 1, today.day)).getUTCDay()
  const monday = addCalendarDays(today, -((weekday + 6) % 7))
  return {
    day: midnightInTimeZone(today, timeZone),
    week: midnightInTimeZone(monday, timeZone),
    month: midnightInTimeZone({ year: today.year, month: today.month, day: 1 }, timeZone),
    year: midnightInTimeZone({ year: today.year, month: 1, day: 1 }, timeZone),
  }
}


export function registerPlatformAdminRoutes(app: FastifyInstance, context: ApiRouteContext): void {
  const { requireAuth, requirePlatformAdmin, supabaseClients, platformAdminProvider, environment } = context
  const recordAuditEvent = createAuditRecorder(supabaseClients)

  // --- Plattform-Administration (Paket 022) -------------------------------------------
  // Alle Routen ab hier sind requirePlatformAdmin-gated und verwenden ausschliesslich den
  // Service-Role-Client: die betroffenen Tabellen haben keinerlei Grant/Policy fuer
  // authenticated (siehe 2026080502_platform_administration.sql).

  app.get('/v1/me/platform-admin-status', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const status = await platformAdminProvider.statusFor(request.auth!.userId)
    return reply.code(200).send(PlatformAdminStatusSchema.parse(status))
  })

  // Einladungsflow statt eines synchronen Sofort-Hinzufuegens (Paket 046): add_platform_admin()
  // verlangte ein bereits existierendes auth.users-Konto, es gab keinen Weg, eine noch nie
  // registrierte Person als Plattform-Admin einzuladen. Siehe
  // 2026081901_platform_admin_invitations.sql.
  //
  // Bewusst ohne Audit-Trail (im Code-Review dieses PRs angemerkt): audit_events.organization_id
  // ist NOT NULL und traegt eine pro-Verein manipulationssichere Hash-Kette (Paket 020) -- laesst
  // sich nicht ohne Eingriff in diese Kette um organisationslose Zeilen erweitern. Die gesamte
  // Plattform-Administration (platform_admins, platform_settings) hat laut Plan 022 ohnehin noch
  // keinen eigenen Audit-Trail; dieselbe Zurueckstellung wie beim LLM-Provider-CRUD (PR #53).
  app.post('/v1/platform-admin-invitations', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    if (!(await requirePlatformAdmin(request, reply))) return
    const input = AddPlatformAdminRequestSchema.parse(request.body)
    const service = supabaseClients.forService()
    const { rawToken, tokenHash } = generateInvitationToken()
    const rpc = await service.rpc('create_platform_admin_invitation', {
      target_email: input.email,
      target_token_hash: tokenHash,
      added_by: request.auth!.userId,
    })
    if (rpc.error) {
      if (rpc.error.message.includes('already_platform_admin')) return reply.code(409).send({ error: 'already_platform_admin', correlationId: request.id })
      if (rpc.error.message.includes('member_cannot_become_platform_admin')) return reply.code(409).send({ error: 'member_cannot_become_platform_admin', correlationId: request.id })
      if (rpc.error.message.includes('invitation_already_open')) return reply.code(409).send({ error: 'invitation_already_open', correlationId: request.id })
      throw rpc.error
    }
    const insertData = rpc.data as Record<string, unknown>

    const urls = platformAdminInvitationUrls(environment.WEB_BASE_URL ?? 'http://localhost:4200', rawToken)
    let emailDelivered = true
    try {
      await sendInvitationThroughSupabaseAuth(service, input.email, urls)
    } catch (error) {
      emailDelivered = false
      request.log.error({ err: error, correlationId: request.id }, 'Supabase platform admin invitation email delivery failed')
    }
    return reply.code(201).send({ ...PlatformAdminInvitationSchema.parse(mapPlatformAdminInvitationRow(insertData)), emailDelivered })
  })

  app.get('/v1/platform-admin-invitations', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    if (!(await requirePlatformAdmin(request, reply))) return
    const service = supabaseClients.forService()
    const result = await service
      .from('platform_admin_invitations')
      .select('id, email, invited_by, expires_at, accepted_at, revoked_at, last_sent_at, send_count, created_at')
      .is('accepted_at', null)
      .is('revoked_at', null)
      .order('created_at', { ascending: false })
    if (result.error) throw result.error
    return reply.code(200).send(result.data.map((row) => PlatformAdminInvitationSchema.parse(mapPlatformAdminInvitationRow(row))))
  })

  app.post('/v1/platform-admin-invitations/:id/resend', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    if (!(await requirePlatformAdmin(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const service = supabaseClients.forService()
    const existing = await service.from('platform_admin_invitations').select('email, accepted_at, revoked_at').eq('id', params.id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data || existing.data.accepted_at || existing.data.revoked_at) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const { rawToken, tokenHash } = generateInvitationToken()
    const rpc = await service.rpc('resend_platform_admin_invitation', { target_invitation_id: params.id, target_token_hash: tokenHash })
    if (rpc.error) {
      if (rpc.error.message.includes('resend_limit_reached')) return reply.code(429).send({ error: 'resend_limit_reached', correlationId: request.id })
      if (rpc.error.message.includes('resent at most once per hour')) return reply.code(429).send({ error: 'resend_rate_limited', correlationId: request.id })
      if (rpc.error.message.includes('not_found')) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
      throw rpc.error
    }
    const updateData = rpc.data as Record<string, unknown>
    const urls = platformAdminInvitationUrls(environment.WEB_BASE_URL ?? 'http://localhost:4200', rawToken)
    let emailDelivered = true
    try {
      await sendInvitationThroughSupabaseAuth(service, existing.data.email as string, urls)
    } catch (error) {
      emailDelivered = false
      request.log.error({ err: error, correlationId: request.id }, 'Supabase platform admin invitation email delivery failed')
    }
    return reply.code(200).send({ ...PlatformAdminInvitationSchema.parse(mapPlatformAdminInvitationRow(updateData)), emailDelivered })
  })

  app.post('/v1/platform-admin-invitations/:id/revoke', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    if (!(await requirePlatformAdmin(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const service = supabaseClients.forService()
    const existing = await service.from('platform_admin_invitations').select('accepted_at, revoked_at').eq('id', params.id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data || existing.data.accepted_at || existing.data.revoked_at) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    // Bedingung im update() selbst statt nur in der vorigen Pruefung: sonst kann die eingeladene
    // Person zwischen dem select() oben und diesem update() annehmen, und der Widerruf setzt
    // revoked_at auf einer bereits angenommenen Zeile (im Code-Review gefunden).
    const update = await service
      .from('platform_admin_invitations')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', params.id)
      .is('accepted_at', null)
      .is('revoked_at', null)
      .select('id, email, invited_by, expires_at, accepted_at, revoked_at, last_sent_at, send_count, created_at')
      .maybeSingle()
    if (update.error) throw update.error
    if (!update.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    return reply.code(200).send(PlatformAdminInvitationSchema.parse(mapPlatformAdminInvitationRow(update.data)))
  })

  // Bewusst kein requirePlatformAdmin: die annehmende Person ist zu diesem Zeitpunkt noch keine
  // Plattform-Admin. accept_platform_admin_invitation() ermittelt den Aufrufer selbst ueber
  // auth.uid() im User-Client-Kontext, nie aus dem Request-Body.
  app.post('/v1/platform-admin-invitations/accept', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const input = AcceptPlatformAdminInvitationRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const rpc = await client.rpc('accept_platform_admin_invitation', { raw_token: input.token })
    if (rpc.error) {
      if (rpc.error.message.includes('invitation_not_found_or_expired')) return reply.code(410).send({ error: 'invitation_not_found_or_expired', correlationId: request.id })
      if (rpc.error.message.includes('invitation_email_mismatch')) return reply.code(403).send({ error: 'invitation_email_mismatch', correlationId: request.id })
      if (rpc.error.message.includes('member_cannot_become_platform_admin')) return reply.code(409).send({ error: 'member_cannot_become_platform_admin', correlationId: request.id })
      throw rpc.error
    }
    // Nicht hartkodiert: accept_platform_admin_invitation() insertiert mit "on conflict (user_id)
    // do nothing" -- ist die annehmende Person zwischendurch bereits Default-Admin geworden,
    // meldete eine hartkodierte Antwort einen falschen Status (im Code-Review gefunden).
    const status = await platformAdminProvider.statusFor(request.auth!.userId)
    return reply.code(200).send(PlatformAdminStatusSchema.parse(status))
  })

  app.get('/v1/platform-admins', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    if (!(await requirePlatformAdmin(request, reply))) return
    const service = supabaseClients.forService()
    const result = await service.from('platform_admins').select('user_id, is_default_admin, created_at').order('created_at')
    if (result.error) throw result.error
    return reply.code(200).send(
      result.data.map((row) => PlatformAdminSchema.parse({ userId: row.user_id, isDefaultAdmin: row.is_default_admin, createdAt: row.created_at })),
    )
  })

  app.delete('/v1/platform-admins/:userId', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    if (!(await requirePlatformAdmin(request, reply))) return
    if (!request.platformAdmin?.isDefaultAdmin) return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
    const params = z.object({ userId: UuidSchema }).parse(request.params)
    const service = supabaseClients.forService()
    const del = await service.from('platform_admins').delete().eq('user_id', params.userId)
    if (del.error) {
      if (del.error.message.includes('cannot be deleted')) return reply.code(400).send({ error: 'cannot_delete_default_admin', correlationId: request.id })
      throw del.error
    }
    return reply.code(204).send()
  })

  app.get('/v1/platform-settings', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    if (!(await requirePlatformAdmin(request, reply))) return
    const service = supabaseClients.forService()
    const result = await service.from('platform_settings').select('key, value, updated_at').order('key')
    if (result.error) throw result.error
    return reply.code(200).send(
      result.data.map((row) => PlatformSettingSchema.parse({ key: row.key, value: row.value, updatedAt: row.updated_at })),
    )
  })

  app.put('/v1/platform-settings/:key', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    if (!(await requirePlatformAdmin(request, reply))) return
    const params = z.object({ key: PlatformSettingKeySchema }).parse(request.params)
    const body = UpdatePlatformSettingRequestSchema.parse(request.body)
    const value = PlatformSettingValueSchemas[params.key].parse(body.value)
    // Der Datenbank-Schalter ist absichtlich nur der Laufzeit-Not-Aus. Aktivieren darf er
    // niemanden, solange der API-Container selbst keine echte Provider-Konfiguration besitzt;
    // das waere sonst eine UI, die "aktiv" meldet, obwohl jeder Publish sicher scheitert.
    const service = supabaseClients.forService()
    if (params.key === 'publishing_enabled' && value === true) {
      if (environment.PUBLISHING_MODE !== 'live') return reply.code(409).send({ error: 'publishing_not_configured', correlationId: request.id })
      // Der Deployment-Modus allein sagt nur, dass dieser API-Container einen echten Adapter
      // verwenden darf. Fuer jeden aktivierten Provider muessen Metadaten UND das separat
      // gespeicherte Secret vorhanden sein, sonst scheitert jeder Publish erst zur Laufzeit.
      const activeProviders = environment.PUBLISHING_PROVIDER
      if (activeProviders.length === 0) return reply.code(409).send({ error: 'publishing_not_configured', correlationId: request.id })
      const [configurations, secrets] = await Promise.all([
        service.from('publishing_provider_configurations').select('provider').in('provider', activeProviders),
        service.from('publishing_provider_secrets').select('provider').in('provider', activeProviders),
      ])
      if (configurations.error) throw configurations.error
      if (secrets.error) throw secrets.error
      const configuredProviders = new Set(configurations.data.map((row) => row.provider as string))
      const secretProviders = new Set(secrets.data.map((row) => row.provider as string))
      if (activeProviders.some((provider) => !configuredProviders.has(provider) || !secretProviders.has(provider))) {
        return reply.code(409).send({ error: 'publishing_not_configured', correlationId: request.id })
      }
    }
    const update = await service
      .from('platform_settings')
      .update({ value, updated_by: request.auth!.userId })
      .eq('key', params.key)
      .select('key, value, updated_at')
      .single()
    if (update.error) throw update.error
    return reply.code(200).send(
      PlatformSettingSchema.parse({ key: update.data.key, value: update.data.value, updatedAt: update.data.updated_at }),
    )
  })

  app.get('/v1/publishing-providers', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    if (!(await requirePlatformAdmin(request, reply))) return
    const service = supabaseClients.forService()
    const [configurations, secrets] = await Promise.all([
      service.from('publishing_provider_configurations').select('provider, client_id, graph_version, updated_at').order('provider'),
      service.from('publishing_provider_secrets').select('provider'),
    ])
    if (configurations.error) throw configurations.error
    if (secrets.error) throw secrets.error
    const secretProviders = new Set(secrets.data.map((row) => row.provider as string))
    return reply.code(200).send(configurations.data.map((row) => PublishingProviderConfigurationSchema.parse({
      provider: row.provider, clientId: row.client_id, graphVersion: row.graph_version,
      hasSecret: secretProviders.has(row.provider as string), updatedAt: row.updated_at,
    })))
  })

  app.put('/v1/publishing-providers/:provider', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    if (!(await requirePlatformAdmin(request, reply))) return
    const params = z.object({ provider: PublishingProviderSchema }).parse(request.params)
    const input = UpdatePublishingProviderConfigurationRequestSchema.parse(request.body)
    const secretBox = createSecretBoxFromEnvironment(environment)
    const sealed = secretBox.seal(input.clientSecret, `publishing-provider:${params.provider}`)
    const service = supabaseClients.forService()
    // Die beiden Tabellen muessen gemeinsam wechseln. Zwei PostgREST-Aufrufe könnten bei einem
    // Fehler Client-ID und Secret aus unterschiedlichen Versionen hinterlassen.
    const configuration = await service.rpc('upsert_publishing_provider_configuration', {
      target_provider: params.provider,
      target_client_id: input.clientId,
      target_graph_version: input.graphVersion ?? null,
      target_client_secret_ciphertext: ciphertextToBytea(sealed.ciphertext),
      target_key_version: sealed.keyVersion,
      actor_user_id: request.auth!.userId,
    }).single()
    if (configuration.error) throw configuration.error
    const configurationRow = z.object({ provider: PublishingProviderSchema, client_id: z.string(), graph_version: z.string().nullable(), updated_at: z.string() }).parse(configuration.data)
    return reply.code(200).send(PublishingProviderConfigurationSchema.parse({
      provider: configurationRow.provider, clientId: configurationRow.client_id, graphVersion: configurationRow.graph_version,
      hasSecret: true, updatedAt: configurationRow.updated_at,
    }))
  })

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
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
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

  // --- Plan 021: Tarife selbst anlegen und pflegen, statt nur per Migration-Seed ------------------
  app.get('/v1/platform-admin/subscription-plans', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    if (!(await requirePlatformAdmin(request, reply))) return
    const service = supabaseClients.forService()
    const plans = await service
      .from('subscription_plans')
      .select('key, display_name, monthly_price_cents, currency, storage_bytes, max_teams, max_departments, is_self_serviceable, sort_order, available_from, available_until')
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
      { key: input.key, display_name: input.displayName, monthly_price_cents: input.monthlyPriceCents, currency: input.currency, storage_bytes: input.storageBytes, max_teams: input.maxTeams, max_departments: input.maxDepartments, is_self_serviceable: input.isSelfServiceable, sort_order: input.sortOrder, available_from: input.availableFrom, available_until: input.availableUntil },
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
    const update = await service
      .from('subscription_plans')
      .update(payload)
      .eq('key', params.key)
      .select('key, display_name, monthly_price_cents, currency, storage_bytes, max_teams, max_departments, is_self_serviceable, sort_order, available_from, available_until')
      .maybeSingle()
    if (update.error) throw update.error
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
