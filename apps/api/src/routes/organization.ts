import {
  CreateOrganizationRequestSchema,
  CreateOrganizationResponseSchema,
  OnboardingStateSchema,
  OnboardingStepSchema,
  OrganizationProfileSchema,
  OrganizationProfileUpdateSchema,
  UuidSchema,
} from '@vereinsfunk/contracts'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { mapProfileRow, toProfileUpdatePayload } from '../apiMappers.js'
import type { ApiRouteContext } from './context.js'

export function registerOrganizationRoutes(app: FastifyInstance, context: ApiRouteContext): void {
  const { requireAuth, requirePermission, supabaseClients } = context

app.post('/v1/organizations', async (request, reply) => {
  if (!(await requireAuth(request, reply))) return
  const input = CreateOrganizationRequestSchema.parse(request.body)
  const client = supabaseClients.forUser(request.auth!.accessToken)
  const rpc = await client.rpc('create_organization', {
    organization_name: input.name,
    first_department_name: input.firstDepartmentName,
    organization_timezone: input.timezone,
  })
  if (rpc.error) {
    if (rpc.error.message.includes('organization limit reached')) {
      return reply.code(429).send({ error: 'organization_limit_reached', correlationId: request.id })
    }
    // Der Trigger aus 2026080602_platform_admin_separation.sql schlaegt erst beim
    // Mitgliedschafts-Insert am Ende von create_organization() zu; die Funktion laeuft in
    // einer Transaktion, die angelegte Organisation wird also vollstaendig zurueckgerollt.
    if (rpc.error.message.includes('platform_admin_cannot_hold_membership')) {
      return reply.code(409).send({ error: 'platform_admin_cannot_hold_membership', correlationId: request.id })
    }
    throw rpc.error
  }
  const organizationId = rpc.data as string
  const created = await client.from('organizations').select('slug').eq('id', organizationId).single()
  if (created.error) throw created.error
  return reply.code(201).send(CreateOrganizationResponseSchema.parse({ organizationId, slug: created.data.slug }))
})

// Bislang gab es nur die PATCH-Route (Paket 009) -- ohne einen Lesepfad kann keine Oberflaeche
// die aktuellen Impressumsangaben vorausgefuellt anzeigen, bevor sie geaendert werden (Paket 020,
// Plan Abschnitt "3. Pflichtangaben und Verantwortung": einstellungen/recht.vue muss die
// bestehenden Werte zuerst LESEN koennen). Dieselbe Berechtigung wie PATCH.
app.get('/v1/organizations/:id/profile', async (request, reply) => {
  if (!(await requireAuth(request, reply))) return
  const params = z.object({ id: UuidSchema }).parse(request.params)
  if (!(await requirePermission(request, reply, 'organization.manage', { organizationId: params.id }))) return
  const client = supabaseClients.forUser(request.auth!.accessToken)
  const result = await client.from('organization_profiles').select().eq('organization_id', params.id).single()
  if (result.error) throw result.error
  return reply.code(200).send(OrganizationProfileSchema.parse(mapProfileRow(result.data)))
})

app.patch('/v1/organizations/:id/profile', async (request, reply) => {
  if (!(await requireAuth(request, reply))) return
  const params = z.object({ id: UuidSchema }).parse(request.params)
  const input = OrganizationProfileUpdateSchema.parse(request.body)
  if (!(await requirePermission(request, reply, 'organization.manage', { organizationId: params.id }))) return
  const client = supabaseClients.forUser(request.auth!.accessToken)
  const update = await client
    .from('organization_profiles')
    .update(toProfileUpdatePayload(input))
    .eq('organization_id', params.id)
    .select()
    .single()
  if (update.error) {
    if (update.error.message.includes('responsible person must be an active member')) {
      return reply.code(400).send({ error: 'invalid_responsible_person', correlationId: request.id })
    }
    throw update.error
  }
  return reply.code(200).send(OrganizationProfileSchema.parse(mapProfileRow(update.data)))
})


app.get('/v1/onboarding', async (request, reply) => {
  if (!(await requireAuth(request, reply))) return
  const query = z.object({ organizationId: UuidSchema }).parse(request.query)
  const client = supabaseClients.forUser(request.auth!.accessToken)
  const onboarding = await client
    .from('organization_onboarding')
    .select('completed_steps, dismissed_at')
    .eq('organization_id', query.organizationId)
    .maybeSingle()
  if (onboarding.error) throw onboarding.error
  if (!onboarding.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
  return reply.code(200).send(
    OnboardingStateSchema.parse({ completedSteps: onboarding.data.completed_steps, dismissedAt: onboarding.data.dismissed_at }),
  )
})

app.post('/v1/onboarding/steps/:step/complete', async (request, reply) => {
  if (!(await requireAuth(request, reply))) return
  const params = z.object({ step: OnboardingStepSchema }).parse(request.params)
  const body = z.object({ organizationId: UuidSchema }).parse(request.body)
  if (!(await requirePermission(request, reply, 'organization.manage', { organizationId: body.organizationId }))) return
  const client = supabaseClients.forUser(request.auth!.accessToken)
  const current = await client
    .from('organization_onboarding')
    .select('completed_steps')
    .eq('organization_id', body.organizationId)
    .single()
  if (current.error) throw current.error
  const completedSteps = Array.from(new Set([...(current.data.completed_steps as string[]), params.step]))
  const update = await client
    .from('organization_onboarding')
    .update({ completed_steps: completedSteps })
    .eq('organization_id', body.organizationId)
    .select('completed_steps, dismissed_at')
    .single()
  if (update.error) throw update.error
  return reply.code(200).send(
    OnboardingStateSchema.parse({ completedSteps: update.data.completed_steps, dismissedAt: update.data.dismissed_at }),
  )
})

}
