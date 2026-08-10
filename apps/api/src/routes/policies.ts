import {
  ApprovalRequestSchema,
  ApprovalStageSchema,
  ChannelQuotaSchema,
  CreateChannelQuotaRequestSchema,
  CreatePolicyReviewerRequestSchema,
  DecideApprovalStageRequestSchema,
  DecideApprovalStageResponseSchema,
  MemberReviewTrustSchema,
  PolicyReviewerSchema,
  PolicyRuleSettingSchema,
  PolicySettingSchema,
  PublicationExecuteResultSchema,
  PublicationSchema,
  RequestApprovalResponseSchema,
  ReresolveApprovalRouteRequestSchema,
  ReresolveApprovalRouteResponseSchema,
  SchedulePublicationRequestSchema,
  SetMemberReviewTrustRequestSchema,
  StalledApprovalRequestSchema,
  type StalledApprovalRequest,
  UpdateChannelQuotaRequestSchema,
  UpdatePolicyRulesRequestSchema,
  UpdatePolicySettingRequestSchema,
  UuidSchema,
  type OutputFormat,
  type PolicyFlagState,
  type PolicyRuleValues,
  type ReviewerRef,
  type ScopeLevel,
} from '@vereinsfunk/contracts'
import { hasPermission, type Permission, type Role } from '@vereinsfunk/authorization'
import {
  evaluateConsent,
  evaluateMediaGate,
  isConsentRecordInvalid,
  isConsentScopeMismatch,
  resolveReviewers,
  resolveReviewRoute,
  scanTextForSensitiveData,
  type MediaGateBlocker,
  type MembershipRecord,
  type ReviewerRef as DomainReviewerRef,
  type resolveEffectiveConfig,
  type StageDefinition,
} from '@vereinsfunk/domain'
import type { PublicationInput, PublicationMedia, SocialPublisher, ValidationResult } from '@vereinsfunk/publishing'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { FastifyInstance } from 'fastify'
import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { byteaToBuffer, createSecretBoxFromEnvironment } from '../secretBox.js'
import type { ApiRouteContext } from './context.js'
import {
  CONSENT_RECORD_SELECT,
  checkRateLimit,
  computeRuleEntry,
  createAuditRecorder,
  fetchAllRows,
  fetchAllRowsForIds,
  fetchMemberTrust,
  fetchPolicyRuleRows,
  isAnyMemberOfOrganization,
  notExpiredFilter,
  ownPolicyRuleRow,
  resolveMembershipScope,
  toPermissionScope,
  type ConsentRecordRow,
  type PolicyRuleRow,
  type PolicyRuleRows,
} from './shared.js'

// Spiegelt authz.resolve_policy_flag() als AND-Reduktion in TS -- dieselbe Duplizierung wie bei
// canAssignRole/canRemoveRole/role_rank (siehe packages/authorization), hier fuer die
// Anzeigezustaende "geerbt/verschaerft/gesperrt" der Richtlinienoberflaeche. Durchgesetzt wird
// weiterhin ausschliesslich in Postgres (RLS und die *_memberships_insert-Policies); dies dient
// nur der Darstellung.
function resolvePolicyFlagState(ancestorEffective: boolean, ownValue: boolean | null, canEdit: boolean): PolicyFlagState {
  return {
    effective: ancestorEffective && (ownValue ?? true),
    ownValue,
    lockedByAncestor: !ancestorEffective,
    canEdit,
  }
}

const POLICY_MANAGE_PERMISSION: Record<ScopeLevel, Permission> = {
  organization: 'organization.manage',
  department: 'department.manage',
  team: 'team.manage',
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

// "any_with_permission" ist keine feste Namensliste, sondern jede Person, die JETZT die
// Berechtigung im Scope haelt (Plan 011, "Fachliches Modell") -- einschliesslich der aeusseren
// Ebenen: authz.has_team_permission faellt auf has_department_permission zurueck, dieses auf
// has_organization_permission. Eine Abteilungsstufe darf deshalb auch die Vereinsleitung
// entscheiden, eine Teamstufe die Freigabeberechtigten der Elternabteilung. Ohne diese Kaskade
// blieb der Pruefkreis einer Abteilung ohne eigene "approver"-Rolle leer, und resolveReviewRoute
// meldete einen empty_reviewer_pool-Blocker (422) fuer eine Konfiguration, die tatsaechlich
// erfuellbar ist -- der Normalfall in einem kleinen Verein, in dem nur die Vereinsleitung
// freigibt (beim eigenen Review dieses Pakets gefunden).
const ORG_ROLES_WITH_APPROVE = (['organization_owner', 'organization_admin', 'social_manager', 'billing_admin', 'organization_viewer'] as const).filter((role) => hasPermission([role], 'post.approve'))
const DEPARTMENT_ROLES_WITH_APPROVE = (['department_admin', 'editor', 'approver', 'contributor', 'viewer'] as const).filter((role) => hasPermission([role], 'post.approve'))
const TEAM_ROLES_WITH_APPROVE = (['team_manager', 'contributor', 'viewer'] as const).filter((role) => hasPermission([role], 'post.approve'))

async function membersWithApprovePermission(
  client: SupabaseClient, organizationId: string, scope: ScopeLevel, departmentId: string | null, teamId: string | null,
): Promise<string[]> {
  const notExpired = notExpiredFilter()
  // Ueber fetchAllRows wie GET /v1/organizations/:id/members: max_rows=1000 wuerde den
  // Prueferkreis eines grossen Vereins still abschneiden und einzelne Berechtigte aus dem
  // eingefrorenen reviewer_snapshot fallen lassen.
  const pages = [
    ...(ORG_ROLES_WITH_APPROVE.length > 0
      ? [fetchAllRows<{ user_id: string }>((from, to) =>
          client.from('organization_memberships').select('user_id').eq('organization_id', organizationId).in('role', ORG_ROLES_WITH_APPROVE).or(notExpired).order('id', { ascending: true }).range(from, to),
        )]
      : []),
    ...(scope !== 'organization' && DEPARTMENT_ROLES_WITH_APPROVE.length > 0
      ? [fetchAllRows<{ user_id: string }>((from, to) =>
          client.from('department_memberships').select('user_id').eq('department_id', departmentId!).in('role', DEPARTMENT_ROLES_WITH_APPROVE).or(notExpired).order('id', { ascending: true }).range(from, to),
        )]
      : []),
    ...(scope === 'team' && TEAM_ROLES_WITH_APPROVE.length > 0
      ? [fetchAllRows<{ user_id: string }>((from, to) =>
          client.from('team_memberships').select('user_id').eq('team_id', teamId!).in('role', TEAM_ROLES_WITH_APPROVE).or(notExpired).order('id', { ascending: true }).range(from, to),
        )]
      : []),
  ]
  const userIds = new Set<string>()
  for (const rows of await Promise.all(pages)) {
    for (const row of rows) userIds.add(row.user_id)
  }
  return Array.from(userIds)
}

function mapReviewerRow(row: { kind: string; user_id: string | null; role: string | null; target_department_id: string | null; target_team_id: string | null }): DomainReviewerRef {
  if (row.kind === 'user') return { kind: 'user', userId: row.user_id! }
  if (row.kind === 'organization_role') return { kind: 'organization_role', role: row.role! }
  if (row.kind === 'department_role') return { kind: 'department_role', departmentId: row.target_department_id!, role: row.role! }
  return { kind: 'team_role', departmentId: row.target_department_id!, teamId: row.target_team_id!, role: row.role! }
}

// Grundlage der Prueferauflösung fuer "named"-Stufen -- eine abgelaufene Mitgliedschaft traegt
// keine Rolle mehr und darf deshalb nicht als Pruefer in den reviewer_snapshot einfrieren.
// request_approval wuerde eine solche Route ohnehin mit invalid_reviewer_snapshot ablehnen, weil
// authz.is_user_member_of_organization dort denselben Ablauffilter anwendet.
async function fetchAllMemberships(client: SupabaseClient, organizationId: string): Promise<MembershipRecord[]> {
  const notExpired = notExpiredFilter()
  // fetchAllRows aus demselben Grund wie in membersWithApprovePermission: eine benannte Rolle
  // duerfte in einem grossen Verein nicht daran scheitern, dass die Mitgliederseite abgeschnitten ist.
  const [orgRows, deptRows, teamRows] = await Promise.all([
    fetchAllRows<{ user_id: string; role: string }>((from, to) =>
      client.from('organization_memberships').select('user_id, role').eq('organization_id', organizationId).or(notExpired).order('id', { ascending: true }).range(from, to),
    ),
    fetchAllRows<{ user_id: string; role: string; department_id: string }>((from, to) =>
      client.from('department_memberships').select('user_id, role, department_id').eq('organization_id', organizationId).or(notExpired).order('id', { ascending: true }).range(from, to),
    ),
    fetchAllRows<{ user_id: string; role: string; team_id: string; department_id: string }>((from, to) =>
      client.from('team_memberships').select('user_id, role, team_id, department_id').eq('organization_id', organizationId).or(notExpired).order('id', { ascending: true }).range(from, to),
    ),
  ])
  return [
    ...orgRows.map((row) => ({ userId: row.user_id, scope: 'organization' as const, role: row.role })),
    ...deptRows.map((row) => ({ userId: row.user_id, scope: 'department' as const, departmentId: row.department_id, role: row.role })),
    ...teamRows.map((row) => ({ userId: row.user_id, scope: 'team' as const, departmentId: row.department_id, teamId: row.team_id, role: row.role })),
  ]
}

const DEFAULT_STAGE_LABEL: Record<ScopeLevel, string> = { organization: 'Verein', department: 'Abteilung', team: 'Team' }

// Baut die Stufendefinitionen innen (Team) nach aussen (Verein) -- nur Ebenen, deren EIGENE
// Zeile review_required = true setzt, tragen eine Stufe bei (Plan 011: additiv, nicht vererbt).
async function buildStageDefinitions(
  client: SupabaseClient, ruleRows: PolicyRuleRows, organizationId: string, departmentId: string, teamId: string | null,
): Promise<StageDefinition[]> {
  const levels: { scope: ScopeLevel; scopeId: string; scopeDepartmentId: string | null; scopeTeamId: string | null }[] = [
    ...(teamId ? [{ scope: 'team' as const, scopeId: teamId, scopeDepartmentId: departmentId, scopeTeamId: teamId }] : []),
    { scope: 'department' as const, scopeId: departmentId, scopeDepartmentId: departmentId, scopeTeamId: null },
    { scope: 'organization' as const, scopeId: organizationId, scopeDepartmentId: null, scopeTeamId: null },
  ]
  const memberships = await fetchAllMemberships(client, organizationId)
  const stages: StageDefinition[] = []
  for (const level of levels) {
    const row = ownPolicyRuleRow(ruleRows, level.scope, level.scopeDepartmentId, level.scopeTeamId)
    if (!row?.review_required) continue
    const mode = row.review_mode ?? 'any_with_permission'
    let reviewerUserIds: string[]
    if (mode === 'named') {
      const reviewerRows = await client.from('policy_reviewers').select('kind, user_id, role, target_department_id, target_team_id').eq('policy_settings_id', row.id)
      if (reviewerRows.error) throw reviewerRows.error
      reviewerUserIds = resolveReviewers(reviewerRows.data.map(mapReviewerRow), memberships).userIds
    } else {
      reviewerUserIds = await membersWithApprovePermission(client, organizationId, level.scope, level.scopeDepartmentId, level.scopeTeamId)
    }
    stages.push({
      scope: level.scope,
      ...(level.scopeDepartmentId ? { scopeDepartmentId: level.scopeDepartmentId } : {}),
      ...(level.scopeTeamId ? { scopeTeamId: level.scopeTeamId } : {}),
      label: row.review_stage_label ?? DEFAULT_STAGE_LABEL[level.scope],
      mode,
      minimumApprovals: row.review_minimum_approvals ?? 1,
      ...(row.review_deadline_hours ? { deadlineHours: row.review_deadline_hours } : {}),
      reviewerUserIds,
    })
  }
  return stages
}

// Fuer freigaben.vue ("wartet auf mich") und die Detailansicht: Faltet post_media ->
// media_derivatives -> media_assets -> face_regions -> consent_records zusammen und ruft
// evaluateConsent je Gesicht auf. Bekannte, dokumentierte Grenze: verknuepfte Personen fuer die
// Namensprüfung kommen ausschliesslich aus einwilligungsgeprueften Gesichtern der Medien dieses
// Beitrags -- ein rein textlicher Beitrag ohne jedes Foto einer Person kann diese Person nicht
// als "verknuepft" kennen (siehe plans/015, "Umsetzung: Ergebnis und Abweichungen").
// minorReviewConfirmed ist bewusst konservativ immer false: ein eigenes, freigabestufenbasiertes
// Minderjaehrigenschutz existiert bereits seit Paket 011 (is_minor_stage) und bleibt die
// eigentliche Durchsetzung; dieser Blocker ist eine zusaetzliche, informative Erinnerung.
async function computeMediaGateBlockersForPostVersion(
  client: SupabaseClient, postVersionId: string, departmentId: string, policy: { consentExpiresOnLeave: boolean },
): Promise<MediaGateBlocker[]> {
  const postVersion = await client.from('post_versions').select('title, caption').eq('id', postVersionId).maybeSingle()
  if (postVersion.error) throw postVersion.error
  if (!postVersion.data) return []

  const postMedia = await client.from('post_media').select('media_derivative_id').eq('post_version_id', postVersionId)
  if (postMedia.error) throw postMedia.error
  const derivativeIds = postMedia.data.map((row) => row.media_derivative_id as string)

  if (derivativeIds.length === 0) {
    const scan = scanTextForSensitiveData(`${postVersion.data.title as string} ${postVersion.data.caption as string}`, [])
    return evaluateMediaGate({
      scanStatus: 'clean', facesConfirmedComplete: true, hasOriginalSelected: false, derivativeCurrent: true,
      faces: [], minorReviewConfirmed: false, namingNotAllowed: scan.namingNotAllowed, sensitiveTextData: scan.sensitiveTextData,
    }).blockers
  }

  const derivatives = await client.from('media_derivatives').select('id, media_asset_id, status').in('id', derivativeIds)
  if (derivatives.error) throw derivatives.error
  const assetIds = Array.from(new Set(derivatives.data.map((row) => row.media_asset_id as string)))
  const [assets, faces] = await Promise.all([
    client.from('media_assets').select('id, mime_type, scan_status').in('id', assetIds),
    client.from('face_regions').select('media_asset_id, subject_kind, decision, consent_record_id').in('media_asset_id', assetIds),
  ])
  if (assets.error) throw assets.error
  if (faces.error) throw faces.error

  const consentRecordIds = Array.from(new Set(faces.data.map((face) => face.consent_record_id as string | null).filter((id): id is string => id !== null)))
  const consents = consentRecordIds.length > 0
    ? await client.from('consent_records').select(CONSENT_RECORD_SELECT).in('id', consentRecordIds)
    : { data: [] as ConsentRecordRow[], error: null as null }
  if (consents.error) throw consents.error
  const consentById = new Map((consents.data as ConsentRecordRow[]).map((row) => [row.id, row]))

  const directoryPersonIds = Array.from(
    new Set((consents.data as ConsentRecordRow[]).map((row) => row.directory_person_id).filter((id): id is string => id !== null)),
  )
  const people = directoryPersonIds.length > 0
    ? await client.from('directory_people').select('id, first_name, last_name, status, is_minor').in('id', directoryPersonIds)
    : { data: [] as { id: string; first_name: string; last_name: string; status: string; is_minor: boolean }[], error: null as null }
  if (people.error) throw people.error
  const personById = new Map(people.data.map((row) => [row.id, row]))

  const now = new Date()
  const mediaKindByAssetId = new Map(
    assets.data.map((row) => [row.id as string, (row.mime_type as string).startsWith('video/') ? ('video' as const) : ('photo' as const)]),
  )

  const faceInputs = faces.data.map((face) => {
    const consent = face.consent_record_id ? consentById.get(face.consent_record_id as string) : undefined
    let consentValid: boolean | undefined
    let consentScopeMismatch: boolean | undefined
    if (face.decision === 'consented' && consent) {
      const person = consent.directory_person_id ? personById.get(consent.directory_person_id) : undefined
      const evaluation = evaluateConsent(
        {
          guardianConfirmed: consent.guardian_confirmed, signerRole: consent.signer_role, supersededBy: consent.superseded_by,
          revokedAt: consent.revoked_at, validFrom: consent.valid_from, validUntil: consent.valid_until,
          scopeStructured: consent.scope_structured, personLeft: person?.status === 'left',
          subjectIsMinor: person?.is_minor ?? false,
        },
        now,
        {
          purpose: 'social_media', platform: null,
          mediaKind: mediaKindByAssetId.get(face.media_asset_id as string) ?? 'photo',
          context: null, departmentId,
        },
        policy,
      )
      consentValid = !isConsentRecordInvalid(evaluation.reasons)
      consentScopeMismatch = isConsentScopeMismatch(evaluation.reasons)
    }
    return {
      subjectKind: face.subject_kind as 'adult' | 'minor' | 'unknown',
      decision: face.decision as 'pending' | 'consented' | 'obscure' | 'exclude',
      consentValid, consentScopeMismatch,
    }
  })

  const linkedPersons = Array.from(personById.values()).map((person) => {
    const consent = Array.from(consentById.values()).find((row) => row.directory_person_id === person.id)
    return { firstName: person.first_name, lastName: person.last_name, namingAllowed: consent?.scope_structured.namingAllowed ?? false }
  })
  const scan = scanTextForSensitiveData(`${postVersion.data.title as string} ${postVersion.data.caption as string}`, linkedPersons)

  const scanStatus: 'clean' | 'pending' | 'failed' = assets.data.some((row) => row.scan_status === 'failed')
    ? 'failed'
    : assets.data.every((row) => row.scan_status === 'clean')
      ? 'clean'
      : 'pending'
  const derivativeCurrent = derivatives.data.every((row) => row.status === 'ready')

  return evaluateMediaGate({
    scanStatus, facesConfirmedComplete: true, hasOriginalSelected: false, derivativeCurrent,
    faces: faceInputs, minorReviewConfirmed: false, namingNotAllowed: scan.namingNotAllowed, sensitiveTextData: scan.sensitiveTextData,
  }).blockers
}

export function registerPolicyRoutes(app: FastifyInstance, context: ApiRouteContext): void {
  const { requireAuth, requirePermission, supabaseClients, roleProvider, environment, createPublisherForConnection } = context
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

  app.post('/v1/post-versions/:id/request-approval', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const version = await client.from('post_versions').select('id, post_id, created_by_user_id, safety_flags').eq('id', params.id).maybeSingle()
    if (version.error) throw version.error
    if (!version.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const post = await client.from('posts').select('id, organization_id, department_id, team_id, status').eq('id', version.data.post_id).maybeSingle()
    if (post.error) throw post.error
    if (!post.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, 'post.submit', { organizationId: post.data.organization_id, departmentId: post.data.department_id }))) return

    const departmentId = post.data.department_id as string
    const teamId = post.data.team_id as string | null
    // Alle Ebenen einmal laden -- Stufenaufbau, die Vereinszeile (allow_review_exemptions) und die
    // effektive Konfiguration lesen dieselben Zeilen.
    const ruleRows = await fetchPolicyRuleRows(client, post.data.organization_id)
    const orgRow = ruleRows.orgRow
    const config = computeRuleEntry(ruleRows, teamId ? 'team' : 'department', teamId ?? departmentId, departmentId).config
    const stages = await buildStageDefinitions(client, ruleRows, post.data.organization_id, departmentId, teamId)
    const authorId = version.data.created_by_user_id as string
    const trust = await fetchMemberTrust(client, authorId, post.data.organization_id, departmentId, teamId)
    const containsMinors = ((version.data.safety_flags as string[]) ?? []).includes('minor')
    const minorReviewerUserIds = containsMinors ? await membersWithApprovePermission(client, post.data.organization_id, 'organization', null, null) : []

    const route = resolveReviewRoute({
      stages,
      trust,
      author: { userId: authorId },
      media: { containsMinors, reviewerUserIds: minorReviewerUserIds },
      selfApprovalAllowed: config.policies.selfApprovalAllowed,
      allowReviewExemptions: orgRow?.allow_review_exemptions ?? true,
    })
    if (route.blockers.length > 0) {
      return reply.code(422).send({ error: 'unfulfillable_stage', blockers: route.blockers, correlationId: request.id })
    }

    // Paket 024: request_approval nimmt keinen "stages"-Parameter mehr entgegen -- die Funktion
    // leitet die Route seit hier selbst ab (authz.resolve_review_route), damit ein per RPC direkt
    // aufrufender Einreichender keinen selbst gewaehlten Pruefkreis mehr einschleusen kann, auch
    // nicht fuer die Minderjaehrigenstufe (siehe plans/024, "Entschiedene Fragen" Punkt 2). Der
    // obige route-Aufruf bleibt als VORSCHAU bestehen, damit ein unerfuellbarer Blocker weiterhin
    // vor dem RPC-Aufruf als 422 gemeldet wird, statt erst am Fehler der RPC selbst.
    const rpc = await client.rpc('request_approval', { target_post_version_id: params.id })
    if (rpc.error) {
      if (rpc.error.message.includes('insufficient_permission')) return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
      if (rpc.error.message.includes('invalid_status')) return reply.code(409).send({ error: 'invalid_status', correlationId: request.id })
      if (rpc.error.message.includes('minor_stage_required')) return reply.code(422).send({ error: 'minor_stage_required', correlationId: request.id })
      if (rpc.error.message.includes('review_required')) return reply.code(422).send({ error: 'review_required', correlationId: request.id })
      if (rpc.error.message.includes('invalid_reviewer_snapshot')) return reply.code(422).send({ error: 'invalid_reviewer_snapshot', correlationId: request.id })
      // Beide sind auf diesem Weg nicht erreichbar -- resolveReviewRoute nummeriert die Stufen selbst
      // von 1 an durch und meldet einen leeren Prueferkreis vorher als Blocker. request_approval ist
      // aber per Grant direkt per RPC erreichbar und prueft deshalb beides selbst.
      if (rpc.error.message.includes('invalid_stage_positions')) return reply.code(422).send({ error: 'invalid_stage_positions', correlationId: request.id })
      if (rpc.error.message.includes('empty_reviewer_snapshot')) return reply.code(422).send({ error: 'empty_reviewer_snapshot', correlationId: request.id })
      if (rpc.error.message.includes('only_author_as_reviewer')) return reply.code(403).send({ error: 'only_author_as_reviewer', correlationId: request.id })
      throw rpc.error
    }
    return reply.code(202).send(
      RequestApprovalResponseSchema.parse({ postId: rpc.data.postId, status: rpc.data.status, approvalRequestId: rpc.data.approvalRequestId ?? null }),
    )
  })

  app.post('/v1/approval-stages/:id/decide', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = DecideApprovalStageRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const rpc = await client.rpc('decide_approval_stage', { target_stage_id: params.id, target_decision: input.decision, target_reason: input.reason ?? null })
    if (rpc.error) {
      if (rpc.error.message.includes('insufficient_permission')) return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
      if (rpc.error.message.includes('invalid_decision')) return reply.code(400).send({ error: 'invalid_request', correlationId: request.id })
      throw rpc.error
    }
    return reply.code(200).send(
      DecideApprovalStageResponseSchema.parse({
        stageId: rpc.data.stageId, stageStatus: rpc.data.stageStatus, postStatus: rpc.data.postStatus,
        ...(rpc.data.nextStageId ? { nextStageId: rpc.data.nextStageId } : {}),
      }),
    )
  })

  // Paket 024: eine laufende Freigabe bewusst neu aufloesen. Kein "stages"-Parameter -- die RPC
  // leitet die Route selbst ab (siehe reresolve_approval_route, authz.resolve_review_route). Die
  // API prueft nur Struktur/Fehlerabbildung, keine Berechtigungsvorabpruefung: reresolve_approval_route
  // prueft department.manage, Autorenausschluss und Begruendungslaenge bereits selbst.
  app.post('/v1/approval-requests/:id/reresolve', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = ReresolveApprovalRouteRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const rpc = await client.rpc('reresolve_approval_route', { target_approval_request_id: params.id, reason: input.reason })
    if (rpc.error) {
      if (rpc.error.message.includes('not_found')) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
      if (rpc.error.message.includes('insufficient_permission')) return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
      if (rpc.error.message.includes('author_cannot_reresolve')) return reply.code(403).send({ error: 'author_cannot_reresolve', correlationId: request.id })
      if (rpc.error.message.includes('invalid_status')) return reply.code(409).send({ error: 'invalid_status', correlationId: request.id })
      if (rpc.error.message.includes('route_has_rejected_stage')) return reply.code(409).send({ error: 'route_has_rejected_stage', correlationId: request.id })
      if (rpc.error.message.includes('ambiguous_stage_mapping')) return reply.code(409).send({ error: 'ambiguous_stage_mapping', correlationId: request.id })
      if (rpc.error.message.includes('reason_required')) return reply.code(400).send({ error: 'reason_required', correlationId: request.id })
      // Guertel und Hosentraeger (Plan, Schritt 6): resolve_review_route berechnet die Route bereits
      // konfigurationstreu, assert_valid_stage_list kann diese Fehler auf diesem Weg praktisch nicht
      // mehr erreichen -- dieselben Fehlernamen wie bei request-approval trotzdem abgebildet.
      if (rpc.error.message.includes('minor_stage_required')) return reply.code(422).send({ error: 'minor_stage_required', correlationId: request.id })
      if (rpc.error.message.includes('invalid_reviewer_snapshot')) return reply.code(422).send({ error: 'invalid_reviewer_snapshot', correlationId: request.id })
      if (rpc.error.message.includes('invalid_stage_positions')) return reply.code(422).send({ error: 'invalid_stage_positions', correlationId: request.id })
      if (rpc.error.message.includes('empty_reviewer_snapshot')) return reply.code(422).send({ error: 'empty_reviewer_snapshot', correlationId: request.id })
      if (rpc.error.message.includes('only_author_as_reviewer')) return reply.code(403).send({ error: 'only_author_as_reviewer', correlationId: request.id })
      throw rpc.error
    }
    return reply.code(200).send(
      ReresolveApprovalRouteResponseSchema.parse({
        postId: rpc.data.postId, approvalRequestId: rpc.data.approvalRequestId, status: rpc.data.status,
        firstStageId: rpc.data.firstStageId ?? null,
      }),
    )
  })

  // Paket 024, "Oberflaeche": festhaengende Freigaben der eigenen Ebene -- nicht nur "wartet auf
  // mich" (GET /v1/approval-stages/mine), sondern jede Anfrage, die eine verwaltende Person sehen
  // darf (approval_requests_select, seit diesem Paket auch department.manage) UND die tatsaechlich
  // haengt: mindestens eine offene/ueberfaellige Stufe ist ueberfaellig, ODER die Anfrage ist
  // invalidiert. Bewusst kleiner als der Plan-Entwurf: "der reviewer_snapshot ist nicht mehr
  // erfuellbar" (unresolvableReviewers) fehlt, siehe plans/024, "Umsetzung: Ergebnis und
  // Abweichungen vom Plan" -- das braucht einen Mitgliedschafts-Ablaufabgleich je Snapshot-Eintrag,
  // ein eigener, spaeter nachziehbarer Schritt.
  app.get('/v1/approval-requests/stalled', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const query = z.object({ organizationId: UuidSchema }).parse(request.query)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const requestRows = await fetchAllRows<{ id: string; post_id: string; post_version_id: string; invalidated_at: string | null }>((from, to) =>
      client.from('approval_requests').select('id, post_id, post_version_id, invalidated_at').eq('organization_id', query.organizationId).order('id', { ascending: true }).range(from, to),
    )
    if (requestRows.length === 0) return reply.code(200).send([])

    const requestIds = requestRows.map((row) => row.id)
    const stageRows = await fetchAllRowsForIds<{ approval_request_id: string; deadline_at: string | null }>(requestIds, (batch, from, to) =>
      client.from('approval_stages').select('approval_request_id, deadline_at').in('approval_request_id', batch).in('status', ['open', 'stalled']).order('id', { ascending: true }).range(from, to),
    )
    const now = Date.now()
    const openRequestIds = new Set(stageRows.map((row) => row.approval_request_id))
    const overdueRequestIds = new Set(
      stageRows.filter((row) => row.deadline_at !== null && new Date(row.deadline_at).getTime() < now).map((row) => row.approval_request_id),
    )
    const stalled = requestRows.filter((row) => openRequestIds.has(row.id) && (row.invalidated_at !== null || overdueRequestIds.has(row.id)))
    if (stalled.length === 0) return reply.code(200).send([])

    const postIds = Array.from(new Set(stalled.map((row) => row.post_id)))
    const postVersionIds = Array.from(new Set(stalled.map((row) => row.post_version_id)))
    const [postRows, versionRows] = await Promise.all([
      fetchAllRowsForIds<{ id: string; department_id: string }>(postIds, (batch, from, to) => client.from('posts').select('id, department_id').in('id', batch).order('id', { ascending: true }).range(from, to)),
      fetchAllRowsForIds<{ id: string; title: string }>(postVersionIds, (batch, from, to) => client.from('post_versions').select('id, title').in('id', batch).order('id', { ascending: true }).range(from, to)),
    ])
    const departmentByPostId = new Map(postRows.map((row) => [row.id, row.department_id]))
    const titleByVersionId = new Map(versionRows.map((row) => [row.id, row.title]))

    return reply.code(200).send(
      stalled
        .map((row) => {
          const departmentId = departmentByPostId.get(row.post_id as string)
          if (!departmentId) return null
          return StalledApprovalRequestSchema.parse({
            approvalRequestId: row.id, postId: row.post_id, postVersionId: row.post_version_id, departmentId,
            postTitle: titleByVersionId.get(row.post_version_id as string) ?? '',
            isOverdue: overdueRequestIds.has(row.id as string), invalidated: row.invalidated_at !== null,
          })
        })
        .filter((row): row is StalledApprovalRequest => row !== null),
    )
  })

  app.get('/v1/post-versions/:id/approval', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const version = await client.from('post_versions').select('id, created_by_user_id').eq('id', params.id).maybeSingle()
    if (version.error) throw version.error
    if (!version.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const approvalRequest = await client.from('approval_requests').select('id, post_id, post_version_id').eq('post_version_id', params.id).order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (approvalRequest.error) throw approvalRequest.error
    if (!approvalRequest.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const isAuthor = version.data.created_by_user_id === request.auth!.userId
    const [stagesResult, decisionsResult, routeChangesResult] = await Promise.all([
      client.from('approval_stages').select('id, position, scope, label, mode, minimum_approvals, is_minor_stage, status, reviewer_snapshot, deadline_at, opened_at').eq('approval_request_id', approvalRequest.data.id).order('position'),
      client.from('approval_decisions').select('id, approval_stage_id, decided_by, decision, reason, created_at').eq('approval_request_id', approvalRequest.data.id),
      client.from('approval_route_changes').select('id, changed_by, reason, stages_before, created_at').eq('approval_request_id', approvalRequest.data.id).order('created_at'),
    ])
    if (stagesResult.error) throw stagesResult.error
    if (decisionsResult.error) throw decisionsResult.error
    if (routeChangesResult.error) throw routeChangesResult.error
    const now = Date.now()
    return reply.code(200).send(
      ApprovalRequestSchema.parse({
        id: approvalRequest.data.id, postId: approvalRequest.data.post_id, postVersionId: approvalRequest.data.post_version_id,
        stages: stagesResult.data.map((stage) => ({
          id: stage.id, position: stage.position, scope: stage.scope, label: stage.label, mode: stage.mode,
          minimumApprovals: stage.minimum_approvals, isMinorStage: stage.is_minor_stage, status: stage.status,
          // Der Autor sieht die Zusammensetzung einer noch nicht geoeffneten Stufe nicht (Plan 011).
          // Ueber opened_at statt einzelner Statuswerte: eine abgelehnte innere Stufe skipped alle
          // FOLGENDEN Stufen direkt aus 'pending', ohne dass sie je 'open' waren -- ein Check nur
          // auf status === 'pending' haette das nach der Ablehnung wieder offengelegt (beim
          // Geheimnisse-Review gefunden).
          reviewerUserIds: isAuthor && stage.opened_at === null ? null : (stage.reviewer_snapshot as { userId: string }[]).map((entry) => entry.userId),
          deadlineAt: stage.deadline_at,
          // 'stalled' ist der markierte Fall derselben Sache -- sonst zeigte eine vom Job markierte
          // Stufe "nicht überfällig" an, obwohl sie es gerade deswegen ist.
          isOverdue: (stage.status === 'open' || stage.status === 'stalled') && stage.deadline_at !== null && new Date(stage.deadline_at as string).getTime() < now,
          // Paket 015: dieser Detail-Endpunkt zeigt (anders als /v1/approval-stages/mine) bewusst
          // keine Medien-Gate-Blocker -- Autor und Pruefende sehen hier den Freigabestatus, die
          // Blocker-Berechnung ist an die Review-Liste gebunden. Dokumentierte Vereinfachung, kein
          // Vergessen: eine spaetere Vereinheitlichung koennte computeMediaGateBlockersForPostVersion
          // auch hier aufrufen.
          mediaGateBlockers: [],
        })),
        decisions: decisionsResult.data.map((decision) => ({
          id: decision.id, approvalStageId: decision.approval_stage_id, decidedBy: decision.decided_by,
          decision: decision.decision, reason: decision.reason, createdAt: decision.created_at,
        })),
        // Paket 024: damit der Autor liest, dass und warum seine Route geaendert wurde
        // (plans/024, "Umsetzung", Schritt 4). stages_before ist bereits die redigierte Projektion.
        routeChanges: routeChangesResult.data.map((change) => ({
          id: change.id, changedBy: change.changed_by, reason: change.reason,
          stagesBefore: change.stages_before, createdAt: change.created_at,
        })),
      }),
    )
  })

  // Fuer freigaben.vue ("wartet auf mich"): RLS liefert jede Stufe, die auth.uid() ueberhaupt sehen
  // darf (u. a. jedes Vereinsmitglied mit Organisationsrolle) -- der Filter auf den eigenen
  // reviewer_snapshot-Eintrag engt das hier auf tatsaechlich zugewiesene Stufen ein.
  // organizationId ist pflichtig: eine Person mit Pruefrollen in mehreren Vereinen saehe sonst die
  // Freigaben ALLER ihrer Vereine in der Liste eines einzelnen (beim Review dieses Pakets gefunden).
  app.get('/v1/approval-stages/mine', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const query = z.object({ organizationId: UuidSchema }).parse(request.query)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    // 'stalled' gehoert dazu: mark_stalled_approval_stages() markiert eine ueberfaellige Stufe, nimmt
    // ihr aber kein Recht (siehe authz.can_decide_stage). Ein Filter nur auf 'open' haette sie aus
    // genau der Liste verschwinden lassen, in der die zustaendige Person sie noch entscheiden soll.
    // fetchAllRows wie bei GET /v1/organizations/:id/members: max_rows=1000 wuerde die Stufenliste
    // einer grossen Organisation still abschneiden, und der Filter unten auf den eigenen
    // reviewer_snapshot-Eintrag liesse eine zustaendige Person ihre zugewiesene Stufe nicht mehr
    // sehen (gefunden im Code-Review dieses Pakets).
    const stageRows = await fetchAllRows<{
      id: string; position: number; scope: string; label: string; mode: string; minimum_approvals: number
      is_minor_stage: boolean; status: string; reviewer_snapshot: { userId: string }[]
      deadline_at: string | null; approval_request_id: string | null
    }>((from, to) =>
      client
        .from('approval_stages')
        .select('id, position, scope, label, mode, minimum_approvals, is_minor_stage, status, reviewer_snapshot, deadline_at, approval_request_id')
        .eq('organization_id', query.organizationId)
        .in('status', ['open', 'stalled'])
        .order('id', { ascending: true })
        .range(from, to),
    )
    const userId = request.auth!.userId
    const now = Date.now()
    const mine = stageRows.filter((row) => (row.reviewer_snapshot as { userId: string }[]).some((entry) => entry.userId === userId))

    const approvalRequestIds = Array.from(new Set(mine.map((row) => row.approval_request_id as string | undefined).filter((id): id is string => Boolean(id))))
    const approvalRequestRows = await fetchAllRowsForIds<{ id: string; post_id: string; post_version_id: string }>(approvalRequestIds, (batch, from, to) =>
      client.from('approval_requests').select('id, post_id, post_version_id').in('id', batch).order('id', { ascending: true }).range(from, to),
    )
    const postVersionByRequestId = new Map(approvalRequestRows.map((row) => [row.id, row.post_version_id]))
    const postIds = Array.from(new Set(approvalRequestRows.map((row) => row.post_id)))
    const postRows = await fetchAllRowsForIds<{ id: string; department_id: string }>(postIds, (batch, from, to) =>
      client.from('posts').select('id, department_id').in('id', batch).order('id', { ascending: true }).range(from, to),
    )
    const departmentByPostId = new Map(postRows.map((row) => [row.id, row.department_id]))
    const postIdByRequestId = new Map(approvalRequestRows.map((row) => [row.id, row.post_id]))

    // Kein unnoetiger Roundtrip auf policy_settings, wenn es (noch) keine einzige aufloesbare
    // Stufe gibt -- betrifft insbesondere den erwarteten Normalfall ohne Inhalts-Pipeline (siehe
    // plans/README.md), in dem approval_stages zwar existieren koennen, aber approval_request_id
    // ins Leere zeigt, solange kein echter Beitrag dahinter steht.
    const policyRows = postIds.length > 0 ? await fetchPolicyRuleRows(client, query.organizationId) : null
    const effectiveConfigByDepartmentId = new Map<string, ReturnType<typeof resolveEffectiveConfig>>()
    function effectivePolicyForDepartment(departmentId: string): { consentExpiresOnLeave: boolean } {
      let config = effectiveConfigByDepartmentId.get(departmentId)
      if (!config) {
        config = computeRuleEntry(policyRows!, 'department', departmentId, null).config
        effectiveConfigByDepartmentId.set(departmentId, config)
      }
      return { consentExpiresOnLeave: config.policies.consentExpiresOnLeave }
    }

    // Mehrere Stufen eines Freigabeantrags zeigen auf dieselbe post_version_id -- ohne Memoisierung
    // wuerden bis zu sieben Abfragen je Stufe unnoetig wiederholt (gefunden im Code-Review).
    const blockersByPostVersionId = new Map<string, Promise<MediaGateBlocker[]>>()
    const blockersByStage = await Promise.all(
      mine.map(async (row) => {
        const postVersionId = postVersionByRequestId.get(row.approval_request_id as string)
        const postId = postIdByRequestId.get(row.approval_request_id as string)
        const departmentId = postId ? departmentByPostId.get(postId) : undefined
        if (!postVersionId || !departmentId) return []
        let pending = blockersByPostVersionId.get(postVersionId)
        if (!pending) {
          pending = computeMediaGateBlockersForPostVersion(client, postVersionId, departmentId, effectivePolicyForDepartment(departmentId))
          blockersByPostVersionId.set(postVersionId, pending)
        }
        return pending
      }),
    )

    return reply.code(200).send(
      mine.map((row, index) =>
        ApprovalStageSchema.parse({
          id: row.id, position: row.position, scope: row.scope, label: row.label, mode: row.mode,
          minimumApprovals: row.minimum_approvals, isMinorStage: row.is_minor_stage, status: row.status,
          reviewerUserIds: (row.reviewer_snapshot as { userId: string }[]).map((entry) => entry.userId),
          deadlineAt: row.deadline_at, isOverdue: row.deadline_at !== null && new Date(row.deadline_at as string).getTime() < now,
          mediaGateBlockers: blockersByStage[index] ?? [],
        }),
      ),
    )
  })

  app.post('/v1/post-versions/:id/schedule', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = SchedulePublicationRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const rpc = await client.rpc('schedule_publication', {
      target_post_version_id: params.id, target_social_connection_id: input.socialConnectionId, target_scheduled_for: input.scheduledFor,
    })
    if (rpc.error) {
      if (rpc.error.message.includes('insufficient_permission')) return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
      if (rpc.error.message.includes('not_found')) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
      if (rpc.error.message.includes('invalid_status')) return reply.code(409).send({ error: 'invalid_status', correlationId: request.id })
      if (rpc.error.message.includes('channel_not_allowed')) return reply.code(422).send({ error: 'channel_not_allowed', correlationId: request.id })
      if (rpc.error.message.includes('quota_exceeded')) return reply.code(409).send({ error: 'quota_exceeded', detail: rpc.error.message, correlationId: request.id })
      throw rpc.error
    }
    return reply.code(201).send(
      PublicationSchema.parse({
        id: rpc.data.id, postVersionId: rpc.data.post_version_id, socialConnectionId: rpc.data.social_connection_id,
        platform: rpc.data.platform, status: rpc.data.status, scheduledFor: rpc.data.scheduled_for,
      }),
    )
  })

  // Paket 025: schedule_publication (oben) legt nur die Zeile an -- kein Code rief bisher
  // SocialPublisher.publish() ueberhaupt auf (plans/025, Ausgangslage). Kein Hatchet-Cron
  // verfuegbar (Paket 004 weiterhin "in Arbeit") -- dieser Endpunkt fuehrt eine FAELLIGE
  // Veroeffentlichung explizit und synchron aus, plant nichts automatisch zu einem kuenftigen
  // Zeitpunkt (dasselbe Muster wie POST /v1/integration-sources/:id/sync).
  app.post('/v1/publications/:id/execute', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const publication = await client
      .from('publications')
      .select('id, organization_id, post_version_id, social_connection_id, platform, status, scheduled_for, idempotency_key')
      .eq('id', params.id)
      .maybeSingle()
    if (publication.error) throw publication.error
    if (!publication.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const version = await client.from('post_versions').select('id, post_id, caption').eq('id', publication.data.post_version_id as string).maybeSingle()
    if (version.error) throw version.error
    if (!version.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const post = await client.from('posts').select('id, department_id').eq('id', version.data.post_id as string).maybeSingle()
    if (post.error) throw post.error
    if (!post.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, 'post.publish', { organizationId: publication.data.organization_id as string, departmentId: post.data.department_id as string }))) return

    const scheduledFor = publication.data.scheduled_for as string | null
    if (scheduledFor !== null && new Date(scheduledFor).getTime() > Date.now()) {
      return reply.code(409).send({ error: 'not_due_yet', correlationId: request.id })
    }

    const service = supabaseClients.forService()
    // Dieselbe Compare-and-Set-Lehre wie bei consent_records' superseded_by (Paket 015): trifft das
    // update keine Zeile, hat ein gleichzeitiger Aufruf bereits gewonnen -- kein automatischer
    // Retry hier, ein fehlgeschlagener/bereits laufender Versuch braucht eine bewusste
    // Neuveroeffentlichung (aus Scope, siehe plans/025).
    const claim = await service.from('publications').update({ status: 'uploading' }).eq('id', params.id).eq('status', 'queued').select('id').maybeSingle()
    if (claim.error) throw claim.error
    if (!claim.data) return reply.code(409).send({ error: 'invalid_status', correlationId: request.id })

    // Nach dem CAS ist die Zeile beansprucht -- jeder Abbruch vor publisher.publish() muss sie
    // wieder freigeben, sonst haengt sie dauerhaft in 'uploading' und ist per CAS nie wieder
    // erreichbar (Code-Review zu PR #25).
    const releaseClaim = async (): Promise<void> => {
      const release = await service.from('publications').update({ status: 'queued' }).eq('id', params.id).eq('status', 'uploading')
      if (release.error) request.log.error({ err: release.error, correlationId: request.id }, 'publication claim release failed')
    }
    // Jeder erzeugte Grant bliebe sonst die volle TTL abrufbar, auch nach einem laengst
    // abgeschlossenen Veroeffentlichungsversuch -- Medien sind per Vorgabe standardmaessig privat
    // (Code-Review zu PR #25, plans/025 Abschnitt 2).
    const revokeGrants = async (): Promise<void> => {
      const revoke = await service.from('publication_media_grants').update({ revoked_at: new Date().toISOString() }).eq('publication_id', params.id).is('revoked_at', null)
      if (revoke.error) request.log.error({ err: revoke.error, correlationId: request.id }, 'publication_media_grants revoke failed')
    }

    let publicationInput: PublicationInput
    let publisher: SocialPublisher
    let validation: ValidationResult
    let nextAttemptNumber: number
    try {
      const connection = await service.from('social_connections').select('external_account_id').eq('id', publication.data.social_connection_id as string).maybeSingle()
      if (connection.error) throw connection.error
      if (!connection.data) { await releaseClaim(); return reply.code(404).send({ error: 'not_found', correlationId: request.id }) }
      const secretRow = await service.from('social_connection_secrets').select('token_ciphertext, token_key_version').eq('social_connection_id', publication.data.social_connection_id as string).maybeSingle()
      if (secretRow.error) throw secretRow.error
      if (!secretRow.data) { await releaseClaim(); return reply.code(404).send({ error: 'not_found', correlationId: request.id }) }
      const accessToken = createSecretBoxFromEnvironment(environment).open(
        byteaToBuffer(secretRow.data.token_ciphertext as string), secretRow.data.token_key_version as string, publication.data.social_connection_id as string,
      )

      // Ohne die Upload-/Freigabepipeline (Plaene 002/003) hat jede aus Plan 025 entstehende
      // post_version keine post_media-Zeilen -- media bleibt dann [], und validate() unten lehnt das
      // unconditional ab (FakePublisher/MetaPublisher, packages/publishing). Das ist korrektes,
      // erwartetes Verhalten, kein Fehler dieses Endpunkts (siehe plans/025, Ausgangslage).
      const mediaRows = await service.from('post_media').select('position, media_derivative_id').eq('post_version_id', version.data.id as string).order('position')
      if (mediaRows.error) throw mediaRows.error
      // Ohne diese Basis-URL entstuende eine unbrauchbare Grant-URL (`undefined/v1/media-grants/...`);
      // FakePublisher.validate() prueft grantUrl nicht, der Fehler bliebe sonst bis zum echten
      // Provider unsichtbar (Code-Review zu PR #25).
      if (mediaRows.data.length > 0 && !environment.API_PUBLIC_BASE_URL) {
        await releaseClaim()
        return reply.code(503).send({ error: 'api_public_base_url_not_configured', correlationId: request.id })
      }
      // Vorab in einer Abfrage laden statt je Zeile: ein Karussell mit zehn Bildern erzeugte sonst
      // zehn sequentielle media_derivatives-Abfragen im Anfrage-Thread (Nitpick im Code-Review
      // dieses Pakets). Die Grants sammeln wir ebenso und schreiben sie als ein Batch-Insert.
      const derivativeIds = mediaRows.data.map((row) => row.media_derivative_id as string)
      const derivativeRows = derivativeIds.length > 0
        ? await service.from('media_derivatives').select('id, sha256, mime_type, status').in('id', derivativeIds)
        : { data: [] as { id: string; sha256: string; mime_type: string; status: string }[], error: null as null }
      if (derivativeRows.error) throw derivativeRows.error
      const derivativeById = new Map(derivativeRows.data.map((row) => [row.id as string, row]))

      const media: PublicationMedia[] = []
      const grantRows: { organization_id: string; media_derivative_id: string; publication_id: string; token_hash: string; expires_at: string }[] = []
      for (const row of mediaRows.data) {
        const derivative = derivativeById.get(row.media_derivative_id as string)
        if (!derivative || derivative.status !== 'ready') continue
        const token = randomBytes(32).toString('base64url')
        grantRows.push({
          organization_id: publication.data.organization_id, media_derivative_id: derivative.id, publication_id: params.id,
          token_hash: createHash('sha256').update(token).digest('hex'), expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
        })
        media.push({
          derivativeId: derivative.id as string, sha256: derivative.sha256 as string, mimeType: derivative.mime_type as string,
          grantUrl: `${environment.API_PUBLIC_BASE_URL}/v1/media-grants/${token}`, role: row.position === 0 ? 'primary' : 'slide',
        })
      }
      if (grantRows.length > 0) {
        const grantInsert = await service.from('publication_media_grants').insert(grantRows)
        if (grantInsert.error) throw grantInsert.error
      }

      publicationInput = {
        publicationId: params.id, postVersionId: version.data.id as string, socialConnectionId: publication.data.social_connection_id as string,
        platform: publication.data.platform as 'instagram' | 'facebook', caption: version.data.caption as string, media,
        idempotencyKey: publication.data.idempotency_key as string,
      }
      publisher = createPublisherForConnection(publicationInput.platform, accessToken, connection.data.external_account_id as string)
      validation = await publisher.validate(publicationInput)

      // unique(publication_id, attempt_number) auf publication_attempts -- ein hartkodierter Wert 1
      // wuerde jeden erneuten Versuch derselben Publication an dieser Constraint scheitern lassen
      // (Code-Review zu PR #25).
      const previousAttempt = await service.from('publication_attempts').select('attempt_number').eq('publication_id', params.id).order('attempt_number', { ascending: false }).limit(1).maybeSingle()
      if (previousAttempt.error) throw previousAttempt.error
      nextAttemptNumber = ((previousAttempt.data?.attempt_number as number | undefined) ?? 0) + 1
    } catch (err) {
      await releaseClaim()
      await revokeGrants()
      throw err
    }

    if (!validation.valid) {
      await revokeGrants()
      const attemptInsert = await service.from('publication_attempts').insert({
        organization_id: publication.data.organization_id, publication_id: params.id, attempt_number: nextAttemptNumber,
        status: 'failed', error_class: 'validation', response_summary: { errors: validation.errors },
      })
      if (attemptInsert.error) request.log.error({ err: attemptInsert.error, correlationId: request.id }, 'publication_attempts insert failed')
      const markFailed = await service.from('publications').update({ status: 'failed' }).eq('id', params.id)
      if (markFailed.error) request.log.error({ err: markFailed.error, correlationId: request.id }, 'publications status update failed')
      return reply.code(422).send({ error: 'validation_failed', detail: validation.errors, correlationId: request.id })
    }

    try {
      const result = await publisher.publish(publicationInput)
      const markPublished = await service.from('publications').update({ status: result.status, provider_publication_id: result.externalId }).eq('id', params.id)
      if (markPublished.error) request.log.error({ err: markPublished.error, correlationId: request.id }, 'publications status update failed')
      const attemptInsert = await service.from('publication_attempts').insert({
        organization_id: publication.data.organization_id, publication_id: params.id, attempt_number: nextAttemptNumber,
        status: result.status, provider_container_id: result.externalId, response_summary: result.permalink ? { permalink: result.permalink } : {},
      })
      if (attemptInsert.error) request.log.error({ err: attemptInsert.error, correlationId: request.id }, 'publication_attempts insert failed')
      await recordAuditEvent(request, {
        organizationId: publication.data.organization_id as string, action: 'post.published', entityType: 'publications', entityId: params.id,
        metadata: { platform: publicationInput.platform, status: result.status },
      })
      await revokeGrants()
      return reply.code(200).send(PublicationExecuteResultSchema.parse({ id: params.id, status: result.status, externalId: result.externalId, permalink: result.permalink }))
    } catch (err) {
      // Klassifikation nach Plan 004: MetaPublisher kodiert den HTTP-Status im Fehlertext
      // ("... (404)"), da SocialPublisher.publish() keinen strukturierten Fehler liefert -- ein
      // 4xx vom Provider ist nicht retry-faehig (falsche Eingabe/Berechtigung), 5xx/Netzwerk schon,
      // ein nicht einordbarer Fehler bleibt unbekannt. Dokumentierte Grenze: haengt am
      // Nachrichtenformat von MetaPublisher, kein strukturierter Fehlertyp ueber SocialPublisher
      // (siehe plans/025, Abschnitt "Umsetzung: Ergebnis und Abweichungen vom Plan").
      const httpStatus = err instanceof Error ? /\((\d{3})\)/.exec(err.message)?.[1] : undefined
      const classification: { errorClass: 'non_retryable' | 'retryable' | 'unknown'; status: 'failed' | 'action_required' } =
        httpStatus && Number(httpStatus) >= 400 && Number(httpStatus) < 500 ? { errorClass: 'non_retryable', status: 'failed' }
        : httpStatus && Number(httpStatus) >= 500 ? { errorClass: 'retryable', status: 'action_required' }
        : { errorClass: 'unknown', status: 'action_required' }
      const markStatus = await service.from('publications').update({ status: classification.status }).eq('id', params.id)
      if (markStatus.error) request.log.error({ err: markStatus.error, correlationId: request.id }, 'publications status update failed')
      const attemptInsert = await service.from('publication_attempts').insert({
        organization_id: publication.data.organization_id, publication_id: params.id, attempt_number: nextAttemptNumber,
        status: 'failed', error_class: classification.errorClass, response_summary: { message: err instanceof Error ? err.message : 'unknown_error' },
      })
      if (attemptInsert.error) request.log.error({ err: attemptInsert.error, correlationId: request.id }, 'publication_attempts insert failed')
      await revokeGrants()
      return reply.code(502).send({ error: 'publish_failed', correlationId: request.id })
    }
  })

  // Kein requireAuth: Meta ruft diese URL serverseitig ab (Plan 006, Abschnitt "Sichere
  // Medienuebergabe"). Nach demselben Muster wie die oeffentlichen Einwilligungs-Token-Seiten aus
  // Paket 015 -- Service Role fuer den Lookup, Hash- statt Rohtoken-Vergleich, keine Unterscheidung
  // zwischen ungueltig/abgelaufen/bereits widerrufen.
  app.get('/v1/media-grants/:token', async (request, reply) => {
    reply.header('X-Robots-Tag', 'noindex, nofollow')
    // Wie die oeffentlichen Einwilligungs-Token-Seiten aus Paket 015 (checkRateLimit, weiter unten
    // in derselben Funktion definiert, aber zur Aufrufzeit laengst initialisiert): ohne Limit loest
    // jeder Aufruf eine unauthentifizierte DB-Abfrage und potenziell einen Storage-Download aus.
    if (!checkRateLimit(`media-grant:${request.ip}`, 60, 60_000)) {
      return reply.code(429).send({ error: 'rate_limited', correlationId: request.id })
    }
    const params = z.object({ token: z.string().min(1) }).parse(request.params)
    const service = supabaseClients.forService()
    const tokenHash = createHash('sha256').update(params.token).digest('hex')
    const grant = await service.from('publication_media_grants').select('media_derivative_id, expires_at, revoked_at').eq('token_hash', tokenHash).maybeSingle()
    if (grant.error) throw grant.error
    if (!grant.data || grant.data.revoked_at !== null || new Date(grant.data.expires_at as string).getTime() < Date.now()) {
      return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    }
    const derivative = await service.from('media_derivatives').select('bucket_id, object_path, mime_type, status').eq('id', grant.data.media_derivative_id as string).maybeSingle()
    if (derivative.error) throw derivative.error
    if (!derivative.data || derivative.data.status !== 'ready') return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const download = await service.storage.from(derivative.data.bucket_id as string).download(derivative.data.object_path as string)
    if (download.error || !download.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const markAccessed = await service.from('publication_media_grants').update({ accessed_at: new Date().toISOString() }).eq('token_hash', tokenHash)
    if (markAccessed.error) request.log.error({ err: markAccessed.error, correlationId: request.id }, 'publication_media_grants accessed_at update failed')
    const bytes = Buffer.from(await download.data.arrayBuffer())
    return reply
      .header('content-type', derivative.data.mime_type as string)
      .header('content-length', bytes.byteLength)
      .header('x-content-type-options', 'nosniff')
      .send(bytes)
  })

  app.get('/v1/organizations/:id/channel-quotas', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    if (!(await isAnyMemberOfOrganization(client, request.auth!.userId, params.id))) {
      return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
    }
    const rows = await client.from('channel_quotas').select('id, scope, department_id, team_id, social_connection_id, period, max_publications').eq('organization_id', params.id)
    if (rows.error) throw rows.error
    return reply.code(200).send(
      rows.data.map((row) =>
        ChannelQuotaSchema.parse({
          id: row.id, scope: row.scope, scopeId: row.team_id ?? row.department_id ?? params.id, socialConnectionId: row.social_connection_id,
          period: row.period, maxPublications: row.max_publications,
        }),
      ),
    )
  })

  app.post('/v1/channel-quotas', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const input = CreateChannelQuotaRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const scope = await resolveMembershipScope(client, input.scope, input.scopeId)
    if (!scope) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, POLICY_MANAGE_PERMISSION[input.scope], scope))) return
    const insert = await client
      .from('channel_quotas')
      .insert({
        organization_id: scope.organizationId, scope: input.scope, department_id: scope.departmentId ?? null, team_id: scope.teamId ?? null,
        social_connection_id: input.socialConnectionId ?? null, period: input.period, max_publications: input.maxPublications,
      })
      .select('id, scope, department_id, team_id, social_connection_id, period, max_publications')
      .single()
    if (insert.error) {
      if (insert.error.code === '23505') return reply.code(409).send({ error: 'quota_already_exists', correlationId: request.id })
      // 23503 = foreign_key_violation, z. B. ein nicht existierender socialConnectionId.
      if (insert.error.code === '23503') return reply.code(404).send({ error: 'not_found', correlationId: request.id })
      throw insert.error
    }
    return reply.code(201).send(
      ChannelQuotaSchema.parse({
        id: insert.data.id, scope: insert.data.scope, scopeId: input.scopeId, socialConnectionId: insert.data.social_connection_id,
        period: insert.data.period, maxPublications: insert.data.max_publications,
      }),
    )
  })

  app.patch('/v1/channel-quotas/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = UpdateChannelQuotaRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const existing = await client.from('channel_quotas').select('organization_id, scope, department_id, team_id').eq('id', params.id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const scope = toPermissionScope(existing.data.organization_id as string, existing.data.department_id as string | null, existing.data.team_id as string | null)
    if (!(await requirePermission(request, reply, POLICY_MANAGE_PERMISSION[existing.data.scope as ScopeLevel], scope))) return
    const update = await client.from('channel_quotas').update({ max_publications: input.maxPublications }).eq('id', params.id).select('id, scope, department_id, team_id, social_connection_id, period, max_publications')
    if (update.error) throw update.error
    // Wie bei DELETE unten: filtert RLS die Zielzeile aus dem UPDATE, trifft die Anweisung null
    // Zeilen ohne Fehler. Ein abschliessendes .single() haette daraus einen 500 gemacht statt eines
    // 403 (derselbe Grund wie bei DELETE /v1/departments/:id, siehe Kommentar dort).
    const updated = update.data[0]
    if (!updated) return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
    return reply.code(200).send(
      ChannelQuotaSchema.parse({
        id: updated.id, scope: updated.scope, scopeId: updated.team_id ?? updated.department_id ?? existing.data.organization_id,
        socialConnectionId: updated.social_connection_id, period: updated.period, maxPublications: updated.max_publications,
      }),
    )
  })

  app.delete('/v1/channel-quotas/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const existing = await client.from('channel_quotas').select('organization_id, scope, department_id, team_id').eq('id', params.id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const scope = toPermissionScope(existing.data.organization_id as string, existing.data.department_id as string | null, existing.data.team_id as string | null)
    if (!(await requirePermission(request, reply, POLICY_MANAGE_PERMISSION[existing.data.scope as ScopeLevel], scope))) return
    const del = await client.from('channel_quotas').delete().eq('id', params.id).select('id')
    if (del.error) throw del.error
    if (del.data.length === 0) return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
    return reply.code(204).send()
  })
}
