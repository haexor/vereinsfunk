import {
  CreatePolicyReviewerRequestSchema,
  PolicyReviewerSchema,
  PolicyRuleSettingSchema,
  UpdatePolicyRulesRequestSchema,
  UuidSchema,
  type OutputFormat,
  type PolicyRuleValues,
  type ReviewerRef,
  type ScopeLevel,
  type SocialPlatform,
} from '@vereinsfunk/contracts'
import type { resolveEffectiveConfig } from '@vereinsfunk/domain'
import type { SupabaseClient } from '@supabase/supabase-js'
import { computeRuleEntry, fetchPolicyRuleRows, type PolicyRuleRow } from '../services/policyRules.js'
import { hasPermission } from '@vereinsfunk/authorization'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ApiRouteContext } from './context.js'
import { createAuditRecorder } from './shared.js'
import { isAnyMemberOfOrganization, POLICY_MANAGE_PERMISSION, resolveMembershipScope, resolveRolesForScopes, toPermissionScope } from '../services/scopeAuthorization.js'
import { policyScopes } from './policies.js'

function mapOwnRowToRuleValues(row: PolicyRuleRow | null): PolicyRuleValues {
  return {
    reviewRequired: row?.review_required ?? null,
    reviewMode: row?.review_mode ?? null,
    reviewStageLabel: row?.review_stage_label ?? null,
    reviewMinimumApprovals: row?.review_minimum_approvals ?? null,
    reviewDeadlineHours: row?.review_deadline_hours ?? null,
    minorApprovalRequired: row?.minor_approval_required ?? null,
    selfApprovalAllowed: row?.self_approval_allowed ?? null,
    allowSameReviewerAcrossStages: row?.allow_same_reviewer_across_stages ?? null,
    allowReviewExemptions: row?.allow_review_exemptions ?? null,
    mediaRequiresConsentCheck: row?.media_requires_consent_check ?? null,
    consentExpiresOnLeave: row?.consent_expires_on_leave ?? null,
    consentValidityMonths: row?.consent_validity_months ?? null,
    allowedPresets: row?.allowed_presets ?? null,
    allowedFormats: row?.allowed_formats ?? null,
    allowedChannelIds: row?.allowed_channel_ids ?? null,
    defaultTargetPlatforms: row?.default_target_platforms ?? null,
    forbiddenTopics: row?.forbidden_topics ?? [],
    requiredHashtags: row?.required_hashtags ?? [],
  }
}

function mapConfigToRuleValues(config: ReturnType<typeof resolveEffectiveConfig>, ownRow: PolicyRuleRow | null): PolicyRuleValues {
  return {
    reviewRequired: ownRow?.review_required ?? null,
    reviewMode: ownRow?.review_mode ?? null,
    reviewStageLabel: ownRow?.review_stage_label ?? null,
    reviewMinimumApprovals: ownRow?.review_minimum_approvals ?? null,
    reviewDeadlineHours: ownRow?.review_deadline_hours ?? null,
    minorApprovalRequired: config.policies.minorApprovalRequired,
    selfApprovalAllowed: config.policies.selfApprovalAllowed,
    allowSameReviewerAcrossStages: config.policies.allowSameReviewerAcrossStages,
    allowReviewExemptions: ownRow?.allow_review_exemptions ?? null,
    mediaRequiresConsentCheck: config.policies.mediaRequiresConsentCheck,
    consentExpiresOnLeave: config.policies.consentExpiresOnLeave,
    // Knotenlokal wie reviewMinimumApprovals (own-Zeile, keine Vererbung ueber Ebenen) --
    // die echte Abteilungs-/Vereins-Rueckfallkette fuer neue Einwilligungen loest
    // computeConsentValidity (services/consent.ts) separat auf, nicht hier.
    consentValidityMonths: ownRow?.consent_validity_months ?? null,
    allowedPresets: config.policies.allowedPresets ? [...config.policies.allowedPresets] : null,
    allowedFormats: config.policies.allowedFormats ? ([...config.policies.allowedFormats] as OutputFormat[]) : null,
    allowedChannelIds: config.policies.allowedChannelIds ? [...config.policies.allowedChannelIds] : null,
    defaultTargetPlatforms: config.policies.defaultTargetPlatforms ? ([...config.policies.defaultTargetPlatforms] as SocialPlatform[]) : null,
    forbiddenTopics: [...config.policies.forbiddenTopics],
    requiredHashtags: [...config.policies.requiredHashtags],
  }
}

const REVIEWER_COLUMNS = 'id, policy_settings_id, kind, user_id, role, target_department_id, target_team_id, created_at'

type ReviewerRow = { id: string; policy_settings_id: string; kind: string; user_id: string | null; role: string | null; target_department_id: string | null; target_team_id: string | null; created_at: string }

function mapPolicyReviewer(row: ReviewerRow, scope: ScopeLevel, scopeId: string) {
  return PolicyReviewerSchema.parse({
    id: row.id, scope, scopeId, kind: row.kind, userId: row.user_id, role: row.role,
    targetDepartmentId: row.target_department_id, targetTeamId: row.target_team_id, createdAt: row.created_at,
  })
}

async function reviewersForPolicySettings(client: SupabaseClient, policySettingsId: string | undefined, scope: ScopeLevel, scopeId: string) {
  if (!policySettingsId) return []
  const rows = await client.from('policy_reviewers').select(REVIEWER_COLUMNS).eq('policy_settings_id', policySettingsId)
  if (rows.error) throw rows.error
  return (rows.data as ReviewerRow[]).map((row) => mapPolicyReviewer(row, scope, scopeId))
}

export function registerPolicyRuleRoutes(app: FastifyInstance, context: ApiRouteContext): void {
  const { requireAuth, requirePermission, supabaseClients, roleProvider } = context
  const recordAuditEvent = createAuditRecorder(supabaseClients)

  app.get('/v1/organizations/:id/policy-rules', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    if (!(await isAnyMemberOfOrganization(client, request.auth!.userId, params.id))) {
      return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
    }
    const organization = await supabaseClients.forService().from('organizations').select('name').eq('id', params.id).maybeSingle()
    if (organization.error) throw organization.error
    if (!organization.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const [departments, teams, ruleRows] = await Promise.all([
      client.from('departments').select('id, name').eq('organization_id', params.id).order('name'),
      client.from('teams').select('id, name, department_id').eq('organization_id', params.id).order('name'),
      fetchPolicyRuleRows(client, params.id),
    ])
    if (departments.error) throw departments.error
    if (teams.error) throw teams.error

    // Prueferzuweisungen fuer alle Ebenen in einer Abfrage statt einer je Eintrag, aus demselben
    // Grund wie fetchPolicyRuleRows oben.
    const policySettingsIds = [
      ...(ruleRows.orgRow ? [ruleRows.orgRow.id] : []),
      ...Array.from(ruleRows.deptRowById.values()).map((row) => row.id),
      ...Array.from(ruleRows.teamRowById.values()).map((row) => row.id),
    ]
    const reviewersByPolicySettingsId = new Map<string, ReviewerRow[]>()
    if (policySettingsIds.length > 0) {
      const reviewerRows = await client.from('policy_reviewers').select(REVIEWER_COLUMNS).in('policy_settings_id', policySettingsIds)
      if (reviewerRows.error) throw reviewerRows.error
      for (const row of reviewerRows.data as ReviewerRow[]) {
        const bucket = reviewersByPolicySettingsId.get(row.policy_settings_id) ?? []
        bucket.push(row)
        reviewersByPolicySettingsId.set(row.policy_settings_id, bucket)
      }
    }

    const rolesByScopeKey = await resolveRolesForScopes(roleProvider, request.auth!, policyScopes(params.id, departments.data, teams.data))
    const canEditFor = (scope: ScopeLevel, scopeId: string) => hasPermission(rolesByScopeKey.get(scope === 'organization' ? 'organization' : `${scope}:${scopeId}`) ?? [], POLICY_MANAGE_PERMISSION[scope])

    function buildEntry(scope: ScopeLevel, scopeId: string, name: string, departmentIdForTeam: string | null) {
      const { ownRow, config } = computeRuleEntry(ruleRows, scope, scopeId, departmentIdForTeam)
      return PolicyRuleSettingSchema.parse({
        scope, scopeId, name,
        own: mapOwnRowToRuleValues(ownRow),
        effective: mapConfigToRuleValues(config, ownRow),
        canEdit: canEditFor(scope, scopeId),
        reviewers: (ownRow ? reviewersByPolicySettingsId.get(ownRow.id) ?? [] : []).map((row) => mapPolicyReviewer(row, scope, scopeId)),
      })
    }

    const entries = [
      buildEntry('organization', params.id, organization.data.name as string, null),
      ...departments.data.map((department) => buildEntry('department', department.id as string, department.name as string, null)),
      ...teams.data.map((team) => buildEntry('team', team.id as string, team.name as string, team.department_id as string)),
    ]
    return reply.code(200).send(entries)
  })

  app.put('/v1/policy-rules', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const input = UpdatePolicyRulesRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const scope = await resolveMembershipScope(client, input.scope, input.scopeId)
    if (!scope) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, POLICY_MANAGE_PERMISSION[input.scope], scope))) return
    const rpc = await client.rpc('set_policy_rules', {
      target_organization_id: scope.organizationId, target_scope: input.scope,
      target_department_id: scope.departmentId ?? null, target_team_id: scope.teamId ?? null,
      patch: input.patch,
    })
    if (rpc.error) {
      if (rpc.error.message.includes('insufficient_permission')) return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
      if (rpc.error.message.includes('unknown_policy_rule_field')) return reply.code(400).send({ error: 'invalid_request', correlationId: request.id })
      // 23514 = check_violation. Zod kann die Kombination reviewMode='named'/reviewRequired nur
      // innerhalb DESSELBEN patch pruefen -- ein frueherer Patch koennte reviewRequired bereits
      // gesetzt haben, ein spaeterer patch={reviewMode:'named'} allein sieht dann fuer Zod
      // vollstaendig gueltig aus und verletzt erst am policy_settings_named_requires_review-Check
      // (beim Vertraege-Review als 500 statt 400 gefunden).
      if (rpc.error.code === '23514') return reply.code(400).send({ error: 'invalid_request', correlationId: request.id })
      throw rpc.error
    }
    await recordAuditEvent(request, { organizationId: scope.organizationId, action: 'policy_rules.changed', entityType: 'policy_settings', entityId: rpc.data.id, metadata: { scope: input.scope, scopeId: input.scopeId, patch: input.patch } })

    const departmentIdForTeam = input.scope === 'team' ? scope.departmentId! : null
    const { ownRow, config } = computeRuleEntry(await fetchPolicyRuleRows(client, scope.organizationId), input.scope, input.scopeId, departmentIdForTeam)
    // .error jeder Namensabfrage einzeln pruefen, wie an jeder anderen Stelle dieser Datei: ohne die
    // Pruefung waere name bei einem Datenbankfehler undefined, PolicyRuleSettingSchema.parse wuerfe
    // einen ZodError, und der Error-Handler antwortete mit 400 invalid_request auf einen
    // Datenbankfehler (beim Review dieses Pakets gefunden).
    const nameQuery =
      input.scope === 'organization'
        ? await supabaseClients.forService().from('organizations').select('name').eq('id', scope.organizationId).single()
        : input.scope === 'department'
          ? await client.from('departments').select('name').eq('id', scope.departmentId!).single()
          : await client.from('teams').select('name').eq('id', scope.teamId!).single()
    if (nameQuery.error) throw nameQuery.error
    const name = nameQuery.data.name as string

    return reply.code(200).send(
      PolicyRuleSettingSchema.parse({
        scope: input.scope, scopeId: input.scopeId, name,
        own: mapOwnRowToRuleValues(ownRow),
        effective: mapConfigToRuleValues(config, ownRow),
        canEdit: true,
        reviewers: await reviewersForPolicySettings(client, ownRow?.id, input.scope, input.scopeId),
      }),
    )
  })

  // Reviewer-Referenzen sind eng an eine policy_settings-Zeile gebunden -- fehlt sie fuer diesen
  // Scope noch, wird sie ueber set_policy_rules mit einem leeren Patch angelegt (dieselbe
  // Race-sichere Select-fuer-Update-dann-Upsert-Logik wie beim eigentlichen Schreiben von Regeln).
  app.post('/v1/policy-reviewers', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const input = CreatePolicyReviewerRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const scope = await resolveMembershipScope(client, input.scope, input.scopeId)
    if (!scope) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, POLICY_MANAGE_PERMISSION[input.scope], scope))) return

    const ensured = await client.rpc('set_policy_rules', {
      target_organization_id: scope.organizationId, target_scope: input.scope,
      target_department_id: scope.departmentId ?? null, target_team_id: scope.teamId ?? null, patch: {},
    })
    if (ensured.error) {
      if (ensured.error.message.includes('insufficient_permission')) return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
      throw ensured.error
    }

    const ref: ReviewerRef = input.ref
    const row: Record<string, unknown> = {
      organization_id: scope.organizationId, policy_settings_id: ensured.data.id, kind: ref.kind, created_by: request.auth!.userId,
      user_id: ref.kind === 'user' ? ref.userId : null,
      role: ref.kind === 'user' ? null : ref.role,
      target_department_id: ref.kind === 'department_role' || ref.kind === 'team_role' ? ref.departmentId : null,
      target_team_id: ref.kind === 'team_role' ? ref.teamId : null,
    }
    const insert = await client.from('policy_reviewers').insert(row).select('id, kind, user_id, role, target_department_id, target_team_id, created_at').single()
    if (insert.error) {
      if (insert.error.code === '23505') return reply.code(409).send({ error: 'already_a_reviewer', correlationId: request.id })
      // 23503 = foreign_key_violation: eine department_role/team_role-Referenz mit einer
      // departmentId/teamId, die nicht existiert (Fremdschluessel schuetzt bereits gegen eine
      // fremde Organisation, siehe Migration -- das hier ist der Tippfehler-/Vertraege-Fall).
      if (insert.error.code === '23503') return reply.code(404).send({ error: 'not_found', correlationId: request.id })
      throw insert.error
    }
    await recordAuditEvent(request, {
      organizationId: scope.organizationId,
      action: 'policy_reviewer.added',
      entityType: 'policy_reviewers',
      entityId: insert.data.id as string,
      metadata: { scope: input.scope, scopeId: input.scopeId, kind: ref.kind },
    })
    return reply.code(201).send(
      PolicyReviewerSchema.parse({
        id: insert.data.id, scope: input.scope, scopeId: input.scopeId, kind: insert.data.kind, userId: insert.data.user_id,
        role: insert.data.role, targetDepartmentId: insert.data.target_department_id, targetTeamId: insert.data.target_team_id, createdAt: insert.data.created_at,
      }),
    )
  })

  app.delete('/v1/policy-reviewers/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const existing = await client.from('policy_reviewers').select('policy_settings_id').eq('id', params.id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const setting = await client.from('policy_settings').select('scope, department_id, team_id, organization_id').eq('id', existing.data.policy_settings_id).single()
    if (setting.error) throw setting.error
    const scope = toPermissionScope(setting.data.organization_id as string, setting.data.department_id as string | null, setting.data.team_id as string | null)
    if (!(await requirePermission(request, reply, POLICY_MANAGE_PERMISSION[setting.data.scope as ScopeLevel], scope))) return
    const del = await client.from('policy_reviewers').delete().eq('id', params.id).select('id')
    if (del.error) throw del.error
    if (del.data.length === 0) return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
    await recordAuditEvent(request, {
      organizationId: setting.data.organization_id as string,
      action: 'policy_reviewer.removed',
      entityType: 'policy_reviewers',
      entityId: params.id,
      metadata: { scope: setting.data.scope, policySettingsId: existing.data.policy_settings_id },
    })
    return reply.code(204).send()
  })
}
