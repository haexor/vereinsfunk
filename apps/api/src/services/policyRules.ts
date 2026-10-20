import type { OutputFormat, ScopeLevel, SocialPlatform } from '@vereinsfunk/contracts'
import type { SupabaseClient } from '@supabase/supabase-js'
import { mergeEffectiveConfig, resolveEffectiveConfig, type ConfigOverride, type TrustRecord } from '@vereinsfunk/domain'
import { notExpiredFilter } from '../supabase.js'
import { scopeLevelOf } from './scopeAuthorization.js'

// Regelaufloesung je Ebene (Paket 011/023) -- gebraucht von routes/policies.ts (Richtlinien-
// Oberflaeche, Freigaberouten) UND vom in app.ts verbleibenden POST /v1/submissions
// (evaluateSubmitPermission vor der ersten Persistenz), deshalb hier statt in einem Route-Modul.
export const POLICY_RULE_COLUMNS =
  'id, submit_requires_permission, review_required, review_mode, review_stage_label, review_minimum_approvals, review_deadline_hours, minor_approval_required, self_approval_allowed, allow_same_reviewer_across_stages, allow_review_exemptions, media_requires_consent_check, allowed_presets, allowed_formats, allowed_channel_ids, forbidden_topics, required_hashtags, consent_expires_on_leave, consent_validity_months, default_target_platforms'

export interface PolicyRuleRow {
  id: string
  review_required: boolean | null
  review_mode: 'any_with_permission' | 'named' | null
  review_stage_label: string | null
  review_minimum_approvals: number | null
  review_deadline_hours: number | null
  minor_approval_required: boolean | null
  self_approval_allowed: boolean | null
  allow_same_reviewer_across_stages: boolean | null
  allow_review_exemptions: boolean | null
  media_requires_consent_check: boolean | null
  allowed_presets: string[] | null
  allowed_formats: OutputFormat[] | null
  allowed_channel_ids: string[] | null
  forbidden_topics: string[]
  required_hashtags: string[]
  // Paket 015: consent_expires_on_leave ist Vererbungssemantik (mergeEffectiveConfig), analog zu
  // media_requires_consent_check; consent_validity_months ist knotenlokal wie
  // review_minimum_approvals -- own/effective in mapConfigToRuleValues (routes/policies.ts) sind identisch.
  consent_expires_on_leave: boolean | null
  consent_validity_months: number | null
  // Plan 044: null = geerbt, [] = ausdruecklich keine Vorauswahl -- siehe mergeReplaceableList
  // (packages/domain) fuer die Merge-Semantik, die sich von allowed_presets/allowed_formats/
  // allowed_channel_ids unterscheidet (Ersetzen statt Schnittmenge).
  default_target_platforms: SocialPlatform[] | null
}

// Alle Regelzeilen einer Organisation in EINER Abfrage, indiziert je Ebene -- dasselbe Muster wie
// fetchPolicyRows fuer die zwei booleschen Flags aus 023. Eine Auflösung je Ebene mit eigener
// Abfrage erzeugte ueber alle Ebenen hinweg eine N+1-Kette (bei 10 Abteilungen und 40 Teams 141
// Abfragen auf policy_settings allein, beim Review dieses Pakets gefunden).
export interface PolicyRuleRows {
  orgRow: PolicyRuleRow | null
  deptRowById: Map<string, PolicyRuleRow>
  teamRowById: Map<string, PolicyRuleRow>
}

export async function fetchPolicyRuleRows(client: SupabaseClient, organizationId: string): Promise<PolicyRuleRows> {
  const rows = await client.from('policy_settings').select(`${POLICY_RULE_COLUMNS}, scope, department_id, team_id`).eq('organization_id', organizationId)
  if (rows.error) throw rows.error
  const data = rows.data as (PolicyRuleRow & { scope: ScopeLevel; department_id: string | null; team_id: string | null })[]
  return {
    orgRow: data.find((row) => row.scope === 'organization') ?? null,
    deptRowById: new Map(data.filter((row) => row.scope === 'department').map((row) => [row.department_id as string, row])),
    teamRowById: new Map(data.filter((row) => row.scope === 'team').map((row) => [row.team_id as string, row])),
  }
}

export function ownPolicyRuleRow(rows: PolicyRuleRows, scope: ScopeLevel, departmentId: string | null, teamId: string | null): PolicyRuleRow | null {
  if (scope === 'organization') return rows.orgRow
  if (scope === 'department') return rows.deptRowById.get(departmentId!) ?? null
  return rows.teamRowById.get(teamId!) ?? null
}

// Nur die Felder mit echter Vererbungssemantik fliessen in mergeEffectiveConfig ein.
// review_required/review_mode/review_stage_label/review_minimum_approvals/review_deadline_hours
// und allow_review_exemptions sind additiv/knotenlokal (Plan 011, "Freigabestufen: additiv") --
// sie werden direkt aus der eigenen Zeile gelesen, nicht ueber Ebenen gemischt.
export function toRuleOverride(row: PolicyRuleRow | null): ConfigOverride {
  if (!row) return {}
  return {
    policies: {
      ...(row.review_required !== null ? { approvalRequired: row.review_required } : {}),
      ...(row.minor_approval_required !== null ? { minorApprovalRequired: row.minor_approval_required } : {}),
      forbiddenTopics: row.forbidden_topics,
      requiredHashtags: row.required_hashtags,
      ...(row.self_approval_allowed !== null ? { selfApprovalAllowed: row.self_approval_allowed } : {}),
      ...(row.allow_same_reviewer_across_stages !== null ? { allowSameReviewerAcrossStages: row.allow_same_reviewer_across_stages } : {}),
      ...(row.media_requires_consent_check !== null ? { mediaRequiresConsentCheck: row.media_requires_consent_check } : {}),
      ...(row.consent_expires_on_leave !== null ? { consentExpiresOnLeave: row.consent_expires_on_leave } : {}),
      allowedPresets: row.allowed_presets,
      allowedFormats: row.allowed_formats,
      allowedChannelIds: row.allowed_channel_ids,
      defaultTargetPlatforms: row.default_target_platforms,
    },
  }
}

// Loest die effektive Konfiguration einer Ebene aus den bereits geladenen Regelzeilen auf, indem
// sie die Kette Verein -> (Abteilung) -> (Team) durchlaeuft (Plan 011 gilt fuer GET-alle wie
// PUT-eine-Ebene gleich).
export function computeRuleEntry(
  rows: PolicyRuleRows, scope: ScopeLevel, scopeId: string, departmentIdForTeam: string | null,
): { ownRow: PolicyRuleRow | null; config: ReturnType<typeof resolveEffectiveConfig> } {
  let config = resolveEffectiveConfig(toRuleOverride(rows.orgRow))
  let ownRow = rows.orgRow
  if (scope !== 'organization') {
    const departmentId = scope === 'department' ? scopeId : departmentIdForTeam!
    const departmentRow = ownPolicyRuleRow(rows, 'department', departmentId, null)
    config = mergeEffectiveConfig(config, toRuleOverride(departmentRow))
    ownRow = departmentRow
    if (scope === 'team') {
      const teamRow = ownPolicyRuleRow(rows, 'team', departmentId, scopeId)
      config = mergeEffectiveConfig(config, toRuleOverride(teamRow))
      ownRow = teamRow
    }
  }
  return { ownRow, config }
}

// Effektive Konfiguration genau des Scopes, in dem ein Beitrag liegt. posts.department_id ist seit
// Migration 2026082504 nullable (null = Vereinsebene), und Verschaerfungen wie
// consentExpiresOnLeave greifen auf jeder Ebene (mergeEffectiveConfig) -- eine feste
// 'department'-Aufloesung uebersah Vereinsbeitraege ebenso wie eine Vorgabe der Team-Ebene.
export function computeScopedEffectiveConfig(rows: PolicyRuleRows, organizationId: string, departmentId: string | null, teamId: string | null) {
  return computeRuleEntry(rows, scopeLevelOf({ departmentId, teamId }), teamId ?? departmentId ?? organizationId, departmentId).config
}

export async function resolveScopedEffectiveConfig(client: SupabaseClient, organizationId: string, departmentId: string | null, teamId: string | null) {
  return computeScopedEffectiveConfig(await fetchPolicyRuleRows(client, organizationId), organizationId, departmentId, teamId)
}

export async function fetchMemberTrust(
  client: SupabaseClient, userId: string, organizationId: string, departmentId: string | null, teamId: string | null,
): Promise<TrustRecord[]> {
  // Eine abgelaufene Befreiung darf keine Freigabestufe mehr entfernen -- deshalb derselbe
  // Ablauffilter wie bei den Mitgliedschaften (beim Review dieses Pakets gefunden).
  const rows = await client
    .from('member_review_trust')
    .select('scope, department_id, team_id, submit_allowed, review_requirement')
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .or(notExpiredFilter())
  if (rows.error) throw rows.error
  return rows.data
    .filter((row) => row.scope === 'organization' || (row.scope === 'department' && row.department_id === departmentId) || (row.scope === 'team' && teamId !== null && row.team_id === teamId))
    .map((row) => ({ scope: row.scope as ScopeLevel, submitAllowed: row.submit_allowed as boolean, reviewRequirement: row.review_requirement as TrustRecord['reviewRequirement'] }))
}
