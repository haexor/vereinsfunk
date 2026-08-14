import {
  MemberReviewTrustSchema,
  PolicyReviewerSchema,
  PolicyRuleSettingSchema,
  PolicySettingSchema,
  SetMemberReviewTrustRequestSchema,
  UpdatePolicyRulesRequestSchema,
  UpdatePolicySettingRequestSchema,
  CreatePolicyReviewerRequestSchema,
  UuidSchema,
  type OutputFormat,
  type PolicyFlagState,
  type PolicyRuleValues,
  type ReviewerRef,
  type ScopeLevel,
  type SocialPlatform,
} from '@vereinsfunk/contracts'
import { hasPermission, type Role } from '@vereinsfunk/authorization'
import type { resolveEffectiveConfig } from '@vereinsfunk/domain'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ApiRouteContext } from './context.js'
import {
  computeRuleEntry,
  createAuditRecorder,
  fetchPolicyRuleRows,
  isAnyMemberOfOrganization,
  POLICY_MANAGE_PERMISSION,
  resolveMembershipScope,
  toPermissionScope,
  type PolicyRuleRow,
} from './shared.js'

function resolvePolicyFlagState(ancestorEffective: boolean, ownValue: boolean | null, canEdit: boolean): PolicyFlagState {
  return {
    effective: ancestorEffective && (ownValue ?? true),
    ownValue,
    lockedByAncestor: !ancestorEffective,
    canEdit,
  }
}

async function fetchPolicyRows(client: SupabaseClient, organizationId: string) {
  const rows = await client
    .from('policy_settings')
    .select('scope, department_id, team_id, invite_allowed, posts_visible_org_wide')
    .eq('organization_id', organizationId)
  if (rows.error) throw rows.error
  const orgRow = rows.data.find((row) => row.scope === 'organization') ?? null
  const deptRowById = new Map(rows.data.filter((row) => row.scope === 'department').map((row) => [row.department_id as string, row]))
  const teamRowById = new Map(rows.data.filter((row) => row.scope === 'team').map((row) => [row.team_id as string, row]))
  return { orgRow, deptRowById, teamRowById }
}

function buildPolicySetting(
  scope: ScopeLevel,
  scopeId: string,
  name: string,
  ownRow: { invite_allowed: boolean | null; posts_visible_org_wide: boolean | null } | null,
  ancestorInviteAllowed: boolean,
  ancestorPostsVisible: boolean,
  canEdit: boolean,
) {
  return PolicySettingSchema.parse({
    scope,
    scopeId,
    name,
    inviteAllowed: resolvePolicyFlagState(ancestorInviteAllowed, ownRow?.invite_allowed ?? null, canEdit),
    postsVisibleOrgWide: resolvePolicyFlagState(ancestorPostsVisible, ownRow?.posts_visible_org_wide ?? null, canEdit),
  })
}

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
    tone: row?.tone ?? null,
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
    // die echte Abteilungs-/Vereins-Rueckfallkette fuer die Registratur-Vorbelegung loest
    // resolveConsentValidityMonths separat auf (POST /v1/consents), nicht hier.
    consentValidityMonths: ownRow?.consent_validity_months ?? null,
    allowedPresets: config.policies.allowedPresets ? [...config.policies.allowedPresets] : null,
    allowedFormats: config.policies.allowedFormats ? ([...config.policies.allowedFormats] as OutputFormat[]) : null,
    allowedChannelIds: config.policies.allowedChannelIds ? [...config.policies.allowedChannelIds] : null,
    defaultTargetPlatforms: config.policies.defaultTargetPlatforms ? ([...config.policies.defaultTargetPlatforms] as SocialPlatform[]) : null,
    forbiddenTopics: [...config.policies.forbiddenTopics],
    requiredHashtags: [...config.policies.requiredHashtags],
    tone: config.tone ?? null,
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

export function registerPolicyRoutes(app: FastifyInstance, context: ApiRouteContext): void {
  const { requireAuth, requirePermission, supabaseClients, roleProvider } = context
  const recordAuditEvent = createAuditRecorder(supabaseClients)

  app.get('/v1/organizations/:id/policy-settings', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    if (!(await isAnyMemberOfOrganization(client, request.auth!.userId, params.id))) {
      return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
    }
    // organizations_select_member verlangt eine Organisationsrolle -- ein reiner Abteilungs- oder
    // Team-Admin ohne Organisationsrolle (der Richtlinien fuer seine eigene Ebene durchaus sehen
    // und setzen darf) saehe hier sonst "not found" statt seiner eigenen Einstellungen (beim
    // Rechte-Review dieses Pakets gefunden). Der Name ist ohnehin nicht sensibel -- authz.
    // membership_scopes() liefert ihn schon heute jedem Mitglied unabhaengig von der Rolle. Die
    // Mitgliedschaftspruefung oben laeuft davor, damit kein Nicht-Mitglied ueberhaupt bis hierher
    // kommt.
    const organization = await supabaseClients.forService().from('organizations').select('name').eq('id', params.id).maybeSingle()
    if (organization.error) throw organization.error
    if (!organization.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const [departments, teams, policyRows] = await Promise.all([
      client.from('departments').select('id, name').eq('organization_id', params.id).order('name'),
      client.from('teams').select('id, name, department_id').eq('organization_id', params.id).order('name'),
      fetchPolicyRows(client, params.id),
    ])
    if (departments.error) throw departments.error
    if (teams.error) throw teams.error
    const { orgRow, deptRowById, teamRowById } = policyRows

    const orgInviteAllowed = orgRow?.invite_allowed ?? true
    const orgPostsVisible = orgRow?.posts_visible_org_wide ?? true

    // Eine Ebene wird fuer die Rollenermittlung nur einmal nachgeschlagen, nach demselben Muster
    // wie rolesByScopeKey in GET /v1/organizations/:id/members -- sonst loest buildPolicySetting
    // pro Eintrag einen eigenen rolesForScope-Aufruf aus (51 Aufrufe bei 10 Abteilungen/40 Teams).
    const rolesByScopeKey = new Map<string, readonly Role[]>()
    rolesByScopeKey.set('organization', await roleProvider.rolesForScope(request.auth!, { organizationId: params.id }))
    await Promise.all([
      ...departments.data.map(async (department) => {
        rolesByScopeKey.set(`department:${department.id}`, await roleProvider.rolesForScope(request.auth!, { organizationId: params.id, departmentId: department.id as string }))
      }),
      ...teams.data.map(async (team) => {
        rolesByScopeKey.set(
          `team:${team.id}`,
          await roleProvider.rolesForScope(request.auth!, { organizationId: params.id, departmentId: team.department_id as string, teamId: team.id as string }),
        )
      }),
    ])
    const canEditFor = (scope: ScopeLevel, scopeId: string) => {
      const roles = rolesByScopeKey.get(scope === 'organization' ? 'organization' : `${scope}:${scopeId}`) ?? []
      return hasPermission(roles, POLICY_MANAGE_PERMISSION[scope])
    }

    const entries = [
      buildPolicySetting('organization', params.id, organization.data.name as string, orgRow, true, true, canEditFor('organization', params.id)),
      ...departments.data.map((department) => {
        const ownRow = deptRowById.get(department.id as string) ?? null
        return buildPolicySetting('department', department.id as string, department.name as string, ownRow, orgInviteAllowed, orgPostsVisible, canEditFor('department', department.id as string))
      }),
      ...teams.data.map((team) => {
        const ownRow = teamRowById.get(team.id as string) ?? null
        const deptRow = deptRowById.get(team.department_id as string) ?? null
        const ancestorInviteAllowed = orgInviteAllowed && (deptRow?.invite_allowed ?? true)
        const ancestorPostsVisible = orgPostsVisible && (deptRow?.posts_visible_org_wide ?? true)
        return buildPolicySetting('team', team.id as string, team.name as string, ownRow, ancestorInviteAllowed, ancestorPostsVisible, canEditFor('team', team.id as string))
      }),
    ]
    return reply.code(200).send(entries)
  })

  app.put('/v1/policy-settings', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const input = UpdatePolicySettingRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const scope = await resolveMembershipScope(client, input.scope, input.scopeId)
    if (!scope) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, POLICY_MANAGE_PERMISSION[input.scope], scope))) return
    const rpc = await client.rpc('set_policy_setting', {
      target_organization_id: scope.organizationId,
      target_scope: input.scope,
      target_department_id: scope.departmentId ?? null,
      target_team_id: scope.teamId ?? null,
      target_flag: input.flag,
      target_value: input.value,
    })
    if (rpc.error) {
      if (rpc.error.message.includes('insufficient_permission')) return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
      // Paket 012: allow_department_owned_channels/require_channel_responsible sind nur auf
      // Vereinsebene sinnvoll -- set_policy_setting() lehnt einen anderen target_scope selbst ab
      // (dieselbe Lehre wie bei request_approval/schedule_publication: die RPC leitet
      // sicherheitsrelevante Werte selbst her statt sie vom Aufrufer zu uebernehmen).
      if (rpc.error.message.includes('organization_only_flag')) return reply.code(422).send({ error: 'organization_only_flag', correlationId: request.id })
      throw rpc.error
    }
    const audit = await supabaseClients.forService().from('audit_events').insert({
      organization_id: scope.organizationId,
      actor_user_id: request.auth!.userId,
      action: 'policy_setting.changed',
      entity_type: 'policy_settings',
      entity_id: rpc.data.id,
      correlation_id: request.id,
      metadata: { scope: input.scope, scopeId: input.scopeId, flag: input.flag, value: input.value },
    })
    if (audit.error) request.log.error({ err: audit.error, correlationId: request.id }, 'audit_events insert failed')

    // Service-Client aus demselben Grund wie im GET-Pendant oben: organizations_select_member
    // verlangt eine Organisationsrolle, die ein Abteilungs-/Team-Admin hier nicht hat.
    const [organization, policyRows] = await Promise.all([
      supabaseClients.forService().from('organizations').select('name').eq('id', scope.organizationId).single(),
      fetchPolicyRows(client, scope.organizationId),
    ])
    if (organization.error) throw organization.error
    const { orgRow, deptRowById } = policyRows
    const orgInviteAllowed = orgRow?.invite_allowed ?? true
    const orgPostsVisible = orgRow?.posts_visible_org_wide ?? true
    let name = organization.data.name as string
    let ownRow: { invite_allowed: boolean | null; posts_visible_org_wide: boolean | null } | null = orgRow
    let ancestorInviteAllowed = true
    let ancestorPostsVisible = true
    if (input.scope !== 'organization') {
      const department = await client.from('departments').select('name').eq('id', scope.departmentId!).single()
      if (department.error) throw department.error
      name = department.data.name as string
      ownRow = policyRows.deptRowById.get(scope.departmentId!) ?? null
      ancestorInviteAllowed = orgInviteAllowed
      ancestorPostsVisible = orgPostsVisible
      if (input.scope === 'team') {
        const team = await client.from('teams').select('name').eq('id', scope.teamId!).single()
        if (team.error) throw team.error
        name = team.data.name as string
        ownRow = policyRows.teamRowById.get(scope.teamId!) ?? null
        const deptRow = deptRowById.get(scope.departmentId!) ?? null
        ancestorInviteAllowed = orgInviteAllowed && (deptRow?.invite_allowed ?? true)
        ancestorPostsVisible = orgPostsVisible && (deptRow?.posts_visible_org_wide ?? true)
      }
    }
    // canEdit ist hier immer true: requirePermission oben hat POLICY_MANAGE_PERMISSION[input.scope]
    // fuer genau diesen Scope bereits bestaetigt, ein erneuter rolesForScope-Aufruf waere redundant.
    return reply.code(200).send(buildPolicySetting(input.scope, input.scopeId, name, ownRow, ancestorInviteAllowed, ancestorPostsVisible, true))
  })

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

    const rolesByScopeKey = new Map<string, readonly Role[]>()
    rolesByScopeKey.set('organization', await roleProvider.rolesForScope(request.auth!, { organizationId: params.id }))
    await Promise.all([
      ...departments.data.map(async (department) => {
        rolesByScopeKey.set(`department:${department.id}`, await roleProvider.rolesForScope(request.auth!, { organizationId: params.id, departmentId: department.id as string }))
      }),
      ...teams.data.map(async (team) => {
        rolesByScopeKey.set(`team:${team.id}`, await roleProvider.rolesForScope(request.auth!, { organizationId: params.id, departmentId: team.department_id as string, teamId: team.id as string }))
      }),
    ])
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
    const audit = await supabaseClients.forService().from('audit_events').insert({
      organization_id: scope.organizationId, actor_user_id: request.auth!.userId, action: 'policy_rules.changed',
      entity_type: 'policy_settings', entity_id: rpc.data.id, correlation_id: request.id,
      metadata: { scope: input.scope, scopeId: input.scopeId, patch: input.patch },
    })
    if (audit.error) request.log.error({ err: audit.error, correlationId: request.id }, 'audit_events insert failed')

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

  // Wie die beiden Policy-Routen oben: ein Nicht-Mitglied bekommt 403, nicht eine leere Liste.
  // Welche Zeilen ein Mitglied sieht, entscheidet member_review_trust_select -- die eigene Zeile und
  // die Ebenen, die es verwaltet; reason ist damit schon zeilenweise geschuetzt.
  app.get('/v1/organizations/:id/member-review-trust', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    if (!(await isAnyMemberOfOrganization(client, request.auth!.userId, params.id))) {
      return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
    }
    const rows = await client
      .from('member_review_trust')
      .select('id, scope, department_id, team_id, user_id, submit_allowed, review_requirement, reason, expires_at')
      .eq('organization_id', params.id)
    if (rows.error) throw rows.error
    return reply.code(200).send(
      rows.data.map((row) =>
        MemberReviewTrustSchema.parse({
          id: row.id, scope: row.scope, scopeId: row.team_id ?? row.department_id ?? params.id, userId: row.user_id,
          submitAllowed: row.submit_allowed, reviewRequirement: row.review_requirement, reason: row.reason, expiresAt: row.expires_at,
        }),
      ),
    )
  })

  app.put('/v1/member-review-trust', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const input = SetMemberReviewTrustRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const scope = await resolveMembershipScope(client, input.scope, input.scopeId)
    if (!scope) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, POLICY_MANAGE_PERMISSION[input.scope], scope))) return
    const rpc = await client.rpc('set_member_review_trust', {
      target_organization_id: scope.organizationId, target_scope: input.scope,
      target_department_id: scope.departmentId ?? null, target_team_id: scope.teamId ?? null,
      target_user_id: input.userId, target_submit_allowed: input.submitAllowed, target_review_requirement: input.reviewRequirement,
      target_reason: input.reason, target_expires_at: input.expiresAt,
    })
    if (rpc.error) {
      if (rpc.error.message.includes('insufficient_permission')) return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
      // Vertrauen fuer eine Person, die diesem Verein nicht angehoert -- user_id traegt keinen
      // zusammengesetzten Fremdschluessel auf den Verein, die RPC prueft es deshalb selbst.
      if (rpc.error.message.includes('user_not_a_member')) return reply.code(422).send({ error: 'user_not_a_member', correlationId: request.id })
      throw rpc.error
    }
    const audit = await supabaseClients.forService().from('audit_events').insert({
      organization_id: scope.organizationId, actor_user_id: request.auth!.userId, action: 'member_review_trust.changed',
      entity_type: 'member_review_trust', entity_id: rpc.data.id, correlation_id: request.id,
      metadata: { scope: input.scope, scopeId: input.scopeId, userId: input.userId, reviewRequirement: input.reviewRequirement },
    })
    if (audit.error) request.log.error({ err: audit.error, correlationId: request.id }, 'audit_events insert failed')
    return reply.code(200).send(
      MemberReviewTrustSchema.parse({
        id: rpc.data.id, scope: input.scope, scopeId: input.scopeId, userId: input.userId,
        submitAllowed: rpc.data.submit_allowed, reviewRequirement: rpc.data.review_requirement, reason: rpc.data.reason, expiresAt: rpc.data.expires_at,
      }),
    )
  })
}
