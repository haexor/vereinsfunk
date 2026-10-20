import {
  DepartmentBrandSchema,
  OrganizationBrandSchema,
  OrganizationBrandUpdateSchema,
  TeamBrandSchema,
  UpdateDepartmentBrandRequestSchema,
  UpdateTeamBrandRequestSchema,
  UuidSchema,
} from '@vereinsfunk/contracts'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import {
  firstBlockedBrandField,
  mapBrandRow,
  mapDepartmentBrandRow,
  mapTeamBrandRow,
  setsAnyBrandField,
} from '../apiMappers.js'
import { parseSupabaseData } from '../supabase.js'
import type { ApiRouteContext } from './context.js'
import { toPermissionScope } from '../services/scopeAuthorization.js'
import { LOGO_ASSET_KINDS, validateBrandAssetReferences } from '../services/brandAssetSelection.js'

const FONT_ASSET_KINDS = new Set(['font'])

// Die drei Asset-Referenzen eines Markenprofils auf jeder Ebene.
function brandProfileAssetReferences(input: {
  logoAssetId?: string | null | undefined
  displayFontAssetId?: string | null | undefined
  bodyFontAssetId?: string | null | undefined
}) {
  return [
    [input.logoAssetId, LOGO_ASSET_KINDS],
    [input.displayFontAssetId, FONT_ASSET_KINDS],
    [input.bodyFontAssetId, FONT_ASSET_KINDS],
  ] as const
}

const DepartmentOrganizationRowSchema = z.object({ organization_id: UuidSchema })

// Laedt die Abteilung ueber den Nutzer-Client (RLS: eine fremde Abteilung ist "nicht gefunden")
// und prueft brand.manage in ihrem Scope. Liefert die organization_id oder null, wenn die
// Antwort bereits gesendet ist. Markenprofil- und Website-Analyse-Routen der Abteilung teilen
// sich diese Pruefung.
export async function authorizeDepartmentBrand(
  context: Pick<ApiRouteContext, 'requirePermission' | 'supabaseClients'>,
  request: FastifyRequest,
  reply: FastifyReply,
  departmentId: string,
): Promise<string | null> {
  const department = await context.supabaseClients
    .forUser(request.auth!.accessToken)
    .from('departments')
    .select('organization_id')
    .eq('id', departmentId)
    .maybeSingle()
  if (department.error) throw department.error
  if (!department.data) {
    reply.code(404).send({ error: 'not_found', correlationId: request.id })
    return null
  }
  const organizationId = parseSupabaseData(DepartmentOrganizationRowSchema, department.data).organization_id
  if (!(await context.requirePermission(request, reply, 'brand.manage', toPermissionScope(organizationId, departmentId))))
    return null
  return organizationId
}

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
    if (!(await validateBrandAssetReferences(client, params.id, {}, brandProfileAssetReferences(input))))
      return reply.code(400).send({ error: 'invalid_asset_reference', correlationId: request.id })
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

  app.put('/v1/departments/:id/brand', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = UpdateDepartmentBrandRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const organizationId = await authorizeDepartmentBrand(context, request, reply, params.id)
    if (organizationId === null) return

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

    if (!(await validateBrandAssetReferences(client, organizationId, { departmentId: params.id }, brandProfileAssetReferences(input))))
      return reply.code(400).send({ error: 'invalid_asset_reference', correlationId: request.id })

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

    if (!(await validateBrandAssetReferences(client, organizationId, { departmentId, teamId: params.id }, brandProfileAssetReferences(input))))
      return reply.code(400).send({ error: 'invalid_asset_reference', correlationId: request.id })

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
