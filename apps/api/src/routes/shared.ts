import type { ConsentScope, GeneratedPost, OutputFormat, ScopeLevel, StyleProfileRules } from '@vereinsfunk/contracts'
import { canRemoveRole, hasPermission, type Permission, type Role } from '@vereinsfunk/authorization'
import type { ApiEnvironment } from '@vereinsfunk/config'
import { AnthropicStructuredContentGenerator, ContentGenerationError, OpenAiCompatibleStructuredContentGenerator, type GroundedContentBrief, type StructuredContentGenerator } from '@vereinsfunk/content-engine'
import { UuidSchema } from '@vereinsfunk/contracts'
import type { SupabaseClient } from '@supabase/supabase-js'
import { mergeEffectiveConfig, resolveEffectiveConfig, type ConfigOverride, type TrustRecord } from '@vereinsfunk/domain'
import type { FastifyRequest } from 'fastify'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { PermissionScope } from '../auth.js'
import { byteaToBuffer, createSecretBoxFromEnvironment } from '../secretBox.js'
import type { SupabaseClientFactory } from './context.js'

// Von mehreren Route-Modulen und dem verbleibenden app.ts benoetigt (Richtlinien/Freigaben,
// Kanaele und Mitglieder/Einladungen loesen alle scope+scopeId oder ein Membership-Tripel auf) --
// hier zentral statt in jedem Modul dupliziert, damit spaetere Extraktionen (Paket 027) diese
// Funktionen nicht erneut abschreiben muessen.

// supabase/config.toml caps a single response at max_rows=1000 -- a plain select() on a large
// organization's membership table would silently truncate the roster. Pages through range()
// until a page comes back short.
//
// Contract: without ORDER BY, Postgres does not guarantee a stable row order between two
// requests -- concurrent writes or a changed query plan can make page 2 repeat or skip rows from
// page 1 (gefunden im Code-Review dieses Pakets). Every fetchPage callback MUST add
// `.order('id', { ascending: true })` (or another column that is both unique and indexed) so
// pages tile the table exactly once.
export async function fetchAllRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const pageSize = 1000
  const rows: T[] = []
  for (let from = 0; ; from += pageSize) {
    const page = await fetchPage(from, from + pageSize - 1)
    if (page.error) throw page.error
    const data = page.data ?? []
    rows.push(...data)
    if (data.length < pageSize) break
  }
  return rows
}

// Ein .in() mit unbegrenzt vielen IDs traegt die gesamte Liste in der Anfrage-URL -- dieselbe
// Grenze wie bei den Profil-Bloecken in GET /members und dem Retention-Lauf. Batcht in Chunks von
// 100, statt die Ergebnisse einer einzelnen Anfrage zu verwerfen. Derselbe Sortier-Vertrag wie
// fetchAllRows gilt je Batch.
export async function fetchAllRowsForIds<T>(
  ids: readonly string[],
  fetchPage: (batch: readonly string[], from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const batchSize = 100
  const rows: T[] = []
  for (let offset = 0; offset < ids.length; offset += batchSize) {
    const batch = ids.slice(offset, offset + batchSize)
    rows.push(...(await fetchAllRows<T>((from, to) => fetchPage(batch, from, to))))
  }
  return rows
}

// Loest scope+scopeId (aus CreateMembershipRequestSchema) in einen PermissionScope auf --
// organizationId muss fuer department/team erst nachgeschlagen werden, damit requirePermission
// und canAssignRole (beide brauchen den vollen Scope-Pfad) korrekt kaskadieren koennen.
export async function resolveMembershipScope(
  client: SupabaseClient,
  scope: ScopeLevel,
  scopeId: string,
): Promise<PermissionScope | null> {
  if (scope === 'organization') return { organizationId: scopeId }
  if (scope === 'department') {
    const department = await client.from('departments').select('organization_id').eq('id', scopeId).maybeSingle()
    if (department.error) throw department.error
    return department.data ? { organizationId: department.data.organization_id as string, departmentId: scopeId } : null
  }
  const team = await client.from('teams').select('organization_id, department_id').eq('id', scopeId).maybeSingle()
  if (team.error) throw team.error
  return team.data ? { organizationId: team.data.organization_id as string, departmentId: team.data.department_id as string, teamId: scopeId } : null
}

// exactOptionalPropertyTypes verbietet departmentId/teamId: undefined -- die Schluessel muessen
// bei Abwesenheit ganz fehlen statt explizit auf undefined gesetzt zu sein.
export function toPermissionScope(organizationId: string, departmentId?: string | null, teamId?: string | null): PermissionScope {
  return { organizationId, ...(departmentId ? { departmentId } : {}), ...(teamId ? { teamId } : {}) }
}

// Wie resolveInvitationScope (routes/members.ts): departmentId/teamId serverseitig gegen ihre
// echte organization_id/department_id verifizieren, BEVOR irgendeine Berechtigung geprueft wird --
// sonst waeren sie client-seitig frei kombinierbar (z. B. eine fremde departmentId zu dieser
// Organisation). Von Verzeichnis, Integration und Einwilligung gebraucht, deshalb hier.
export async function resolveDirectoryScope(
  client: SupabaseClient,
  organizationId: string,
  departmentId: string | null,
  teamId: string | null,
): Promise<PermissionScope | null> {
  if (teamId) {
    const team = await client.from('teams').select('organization_id, department_id').eq('id', teamId).maybeSingle()
    if (team.error) throw team.error
    if (!team.data || team.data.organization_id !== organizationId || team.data.department_id !== departmentId) return null
    return { organizationId, departmentId: team.data.department_id as string, teamId }
  }
  if (departmentId) {
    const department = await client.from('departments').select('organization_id').eq('id', departmentId).maybeSingle()
    if (department.error) throw department.error
    if (!department.data || department.data.organization_id !== organizationId) return null
    return { organizationId, departmentId }
  }
  return { organizationId }
}

// Eine befristete Mitgliedschaft oder Befreiung ist nach expires_at wirkungslos. Jede Abfrage auf
// organization_memberships/department_memberships/team_memberships/member_review_trust, deren
// Ergebnis eine Berechtigung traegt, filtert damit -- dieselbe Bedingung, die die authz-Funktionen
// in SQL verwenden ("expires_at is null or expires_at > now()"). Als gemeinsamer Helfer, damit die
// Stellen nicht auseinanderlaufen (beim Review dieses Pakets gefunden: drei Stellen ohne Filter).
export function notExpiredFilter(): string {
  return `expires_at.is.null,expires_at.gt.${new Date().toISOString()}`
}

// Deckt dieselbe Mitgliedschaft ab wie authz.is_any_member_of_organization (RLS-Grundlage von
// policy_settings_select): Organisationsrolle ODER Abteilungs- ODER Teammitgliedschaft, nicht
// nur eine Organisationsrolle wie roleProvider.rolesForScope(..., { organizationId }) allein
// prueft. Von Richtlinien/Freigaben und mehreren noch nicht extrahierten Domaenen (Kanaele,
// Integration, Datenschutz) gebraucht -- deshalb hier statt je Modul dupliziert.
export async function isAnyMemberOfOrganization(client: SupabaseClient, userId: string, organizationId: string): Promise<boolean> {
  const notExpired = notExpiredFilter()
  const [org, department, team] = await Promise.all([
    client.from('organization_memberships').select('id').eq('organization_id', organizationId).eq('user_id', userId).or(notExpired).limit(1),
    client.from('department_memberships').select('id').eq('organization_id', organizationId).eq('user_id', userId).or(notExpired).limit(1),
    client.from('team_memberships').select('id').eq('organization_id', organizationId).eq('user_id', userId).or(notExpired).limit(1),
  ])
  if (org.error) throw org.error
  if (department.error) throw department.error
  if (team.error) throw team.error
  return org.data.length > 0 || department.data.length > 0 || team.data.length > 0
}

// Einfacher In-Prozess-Sliding-Window-Zaehler statt einer neuen Abhaengigkeit (@fastify/rate-limit):
// die oeffentlichen Einwilligungsseiten unten sind die exponierteste Flaeche des Systems (Plan
// 015, Abschnitt 3) und brauchen ein Rate-Limit pro IP und pro Token. Fuer einen einzelnen
// API-Prozess ausreichend; ein mehrknotiges Produktions-Deployment braucht einen gemeinsamen
// Speicher (Redis) statt dieser lokalen Map -- dokumentierte Grenze, kein stiller Kompromiss.
// Modul-Singleton: von app.ts (Datenschutz-Routen) und routes/policies.ts (Media-Grants) geteilt,
// damit beide weiterhin denselben Zaehler pro Praefix-Key benutzen.
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>()
let nextRateLimitSweepAt = 0
export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  // Diese Routen sind oeffentlich erreichbar; ohne Aufraeumen wuerde jede neue Quell-IP dauerhaft
  // einen Eintrag belegen (gefunden im Code-Review). Nur bei Bedarf durchsuchen, statt bei jedem
  // Aufruf ueber die ganze Map zu iterieren -- und selbst dann hoechstens einmal pro Minute, sonst
  // wuerde ein Schwarm neuer IPs bei gleichzeitig >10.000 aktiven Eintraegen (resetAt >= now, der
  // Durchlauf loescht dann nichts) jeden weiteren Aufruf erneut die ganze Map durchsuchen lassen.
  if (rateLimitBuckets.size > 10_000 && now >= nextRateLimitSweepAt) {
    nextRateLimitSweepAt = now + 60_000
    for (const [bucketKey, entry] of rateLimitBuckets) {
      if (entry.resetAt < now) rateLimitBuckets.delete(bucketKey)
    }
  }
  const bucket = rateLimitBuckets.get(key)
  if (!bucket || bucket.resetAt < now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }
  if (bucket.count >= limit) return false
  bucket.count += 1
  return true
}

// Dieselbe Form wie die inline geschriebenen audit_events-Inserts (Service-Client, weil
// audit_events fuer authenticated keine INSERT-Policy hat; Fehler werden geloggt, nicht geworfen --
// ein fehlgeschlagener Audit-Eintrag darf die bereits durchgefuehrte Aenderung nicht nachtraeglich
// als Fehler ausgeben). Als Factory statt einer einzelnen Funktion, weil recordAuditEvent
// supabaseClients aus der Closure von buildApp brauchte -- app.ts und jedes Route-Modul rufen
// createAuditRecorder(supabaseClients) einmal auf und behalten den vertrauten Zwei-Parameter-Aufruf.
export function createAuditRecorder(supabaseClients: SupabaseClientFactory) {
  return async function recordAuditEvent(
    request: FastifyRequest,
    event: { organizationId: string; action: string; entityType: string; entityId: string | null; metadata?: Record<string, unknown> },
  ): Promise<void> {
    const audit = await supabaseClients.forService().from('audit_events').insert({
      organization_id: event.organizationId,
      actor_user_id: request.auth!.userId,
      action: event.action,
      entity_type: event.entityType,
      entity_id: event.entityId,
      correlation_id: request.id,
      metadata: event.metadata ?? {},
    })
    if (audit.error) request.log.error({ err: audit.error, correlationId: request.id }, 'audit_events insert failed')
  }
}

// Gemeinsame Zeilenform fuer consent_records (Paket 015) -- gebraucht sowohl von den noch nicht
// extrahierten Datenschutz-Routen als auch von computeMediaGateBlockersForPostVersion in
// routes/policies.ts (Freigabe-Medien-Gate liest bestehende Einwilligungen).
export const CONSENT_RECORD_SELECT =
  'id, organization_id, directory_person_id, pseudonymous_subject_ref, scope, scope_structured, origin, source_id, signed_at, signer_name, signer_role, guardian_confirmed, valid_from, valid_until, revoked_at, revoked_by, revocation_reason, superseded_by, created_at'

export type ConsentRecordRow = {
  id: string
  organization_id: string
  directory_person_id: string | null
  pseudonymous_subject_ref: string | null
  scope: string
  scope_structured: ConsentScope
  origin: 'paper' | 'digital' | 'imported'
  source_id: string | null
  signed_at: string | null
  signer_name: string | null
  signer_role: 'self' | 'guardian' | null
  guardian_confirmed: boolean
  valid_from: string
  valid_until: string | null
  revoked_at: string | null
  revoked_by: 'self' | 'guardian' | 'organization' | null
  revocation_reason: string | null
  superseded_by: string | null
  created_at: string
}

// Regelaufloesung je Ebene (Paket 011/023) -- gebraucht von routes/policies.ts (Richtlinien-
// Oberflaeche, Freigaberouten) UND vom in app.ts verbleibenden POST /v1/submissions
// (evaluateSubmitPermission vor der ersten Persistenz), deshalb hier statt in einem Route-Modul.
export const POLICY_RULE_COLUMNS =
  'id, submit_requires_permission, review_required, review_mode, review_stage_label, review_minimum_approvals, review_deadline_hours, minor_approval_required, self_approval_allowed, allow_same_reviewer_across_stages, allow_review_exemptions, media_requires_consent_check, allowed_presets, allowed_formats, allowed_channel_ids, forbidden_topics, required_hashtags, tone, consent_expires_on_leave, consent_validity_months'

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
  tone: string | null
  // Paket 015: consent_expires_on_leave ist Vererbungssemantik (mergeEffectiveConfig), analog zu
  // media_requires_consent_check; consent_validity_months ist knotenlokal wie
  // review_minimum_approvals -- own/effective in mapConfigToRuleValues (routes/policies.ts) sind identisch.
  consent_expires_on_leave: boolean | null
  consent_validity_months: number | null
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

export async function resolveScopedEffectiveConfig(client: SupabaseClient, organizationId: string, departmentId: string, teamId: string | null) {
  const rows = await fetchPolicyRuleRows(client, organizationId)
  return computeRuleEntry(rows, teamId ? 'team' : 'department', teamId ?? departmentId, departmentId).config
}

export async function fetchMemberTrust(
  client: SupabaseClient, userId: string, organizationId: string, departmentId: string, teamId: string | null,
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

// Welche Berechtigung eine Ebene verwaltet -- von Richtlinien, Prueferzuweisungen und
// Kontingenten gleichermassen gebraucht.
export const POLICY_MANAGE_PERMISSION: Record<ScopeLevel, Permission> = {
  organization: 'organization.manage',
  department: 'department.manage',
  team: 'team.manage',
}

// Spaltenliste einer social_connections-Zeile -- von Kanalverwaltung und OAuth-Auswahl geteilt.
export const SOCIAL_CONNECTION_COLUMNS =
  'id, platform, external_account_id, display_name, status, token_expires_at, last_verified_at, owner_scope, owner_department_id, responsible_profile_id, purpose, confidential, archived_at, created_at, imprint_url, privacy_url, editorial_responsible_profile_id, editorial_responsible_note'

// Massgeblich fuer jede Kanal-Berechtigung ist der Kanalbesitz: eine Verbindung im Besitz einer
// Abteilung wird in deren Scope geprueft, eine vereinseigene auf Vereinsebene (Plan 012,
// "Zuordnung und Verantwortung"). Stand sechsmal wortgleich in routes/channels.ts.
export function channelOwnerScope(row: { organization_id: unknown; owner_scope: unknown; owner_department_id: unknown }): PermissionScope {
  return toPermissionScope(row.organization_id as string, row.owner_scope === 'department' ? (row.owner_department_id as string) : null)
}

// Welche Aktionen der ANFRAGENDE auf einer Mitgliedschaftszeile ausfuehren darf. Die Antwort traegt
// die Rechte mit, statt das Frontend sie zweitens herleiten zu lassen (Paket 023) -- viermal
// wortgleich in routes/members.ts, deshalb hier einmal.
export function membershipCapabilities(actorRoles: readonly Role[], targetRole: Role) {
  const canRemoveTarget = canRemoveRole(actorRoles, targetRole)
  return {
    canChangeRole: hasPermission(actorRoles, 'member.invite') && canRemoveTarget,
    canSetExpiry: hasPermission(actorRoles, 'member.invite') && canRemoveTarget,
    canRemove: hasPermission(actorRoles, 'member.remove') && canRemoveTarget,
  }
}

// POST /v1/invitations nimmt organizationId/departmentId/teamId direkt vom Client entgegen.
// Ungeprueft wuerde requirePermission auf einer Scope-Kette pruefen, die client-seitig frei
// kombinierbar ist (z. B. eine fremde organizationId zusammen mit der eigenen departmentId) --
// beim Mandantentrennung-Review gefunden, dort nur zufaellig durch den FK-Constraint auf
// invitations abgefangen.
export async function resolveInvitationScope(
  client: SupabaseClient,
  input: { organizationId: string; departmentId?: string | null | undefined; teamId?: string | null | undefined },
): Promise<{ scope: PermissionScope; scopeName: string } | null> {
  if (input.teamId) {
    const team = await client.from('teams').select('organization_id, department_id, name').eq('id', input.teamId).maybeSingle()
    if (team.error) throw team.error
    if (!team.data || team.data.organization_id !== input.organizationId || team.data.department_id !== input.departmentId) return null
    return {
      scope: { organizationId: team.data.organization_id as string, departmentId: team.data.department_id as string, teamId: input.teamId },
      scopeName: team.data.name as string,
    }
  }
  if (input.departmentId) {
    const department = await client.from('departments').select('organization_id, name').eq('id', input.departmentId).maybeSingle()
    if (department.error) throw department.error
    if (!department.data || department.data.organization_id !== input.organizationId) return null
    return { scope: { organizationId: department.data.organization_id as string, departmentId: input.departmentId }, scopeName: department.data.name as string }
  }
  return { scope: { organizationId: input.organizationId }, scopeName: '' }
}

// Plan 040: "Persona/Stilprofil testen" (routes/content.ts, routes/platformPersonas.routes.ts)
// calls the active text provider directly and synchronously, unlike POST
// /v1/text-workshop/sessions which only ever writes an ID-only Hatchet delivery for the worker to
// pick up. The provider row shape and its decryption mirror apps/worker/src/context.ts's
// loadActiveTextProvider/apps/worker/src/textGeneration.ts's parseSecretBox+ciphertextBuffer --
// duplicated deliberately rather than imported, since apps do not depend on each other in this
// workspace (see pnpm-workspace.yaml); the actual provider adapters
// (OpenAiCompatibleStructuredContentGenerator/AnthropicStructuredContentGenerator) and the secret
// box helpers already live in shared packages apps/api depends on regardless.
const ActiveTextProviderRowSchema = z.object({
  id: UuidSchema, protocol: z.string(), base_url: z.url(), model: z.string().trim().min(1),
  temperature: z.coerce.number(), max_output_tokens: z.coerce.number().int().positive(),
  structured_output_required: z.boolean(),
  llm_provider_secrets: z.union([
    z.object({ api_key_ciphertext: z.string().min(1), key_version: z.string().trim().min(1) }),
    z.array(z.object({ api_key_ciphertext: z.string().min(1), key_version: z.string().trim().min(1) })).min(1),
  ]),
})

const PREVIEW_TEXT_GENERATORS: Record<string, StructuredContentGenerator | undefined> = {
  openai: new OpenAiCompatibleStructuredContentGenerator(),
  anthropic: new AnthropicStructuredContentGenerator(),
}

export type StyleProfilePreviewResult =
  | { ok: true; post: GeneratedPost }
  | { ok: false; status: number; error: string }

// Same shape as packages/contracts/src/integrations.ts's SyncIdempotencyKeySchema, duplicated
// rather than imported: that one is named for the sync domain, and this header is generic HTTP
// convention, not a sync concept.
const PreviewIdempotencyKeySchema = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)

// A client-side timeout/retry on either preview route must not trigger a second billed provider
// call for the same logical attempt (gefunden im Code-Review dieses Pakets). The integrations
// sync route (routes/integrations.ts) guards the same problem with an atomic RPC backed by the
// idempotency_keys table, but that table requires a non-null organization_id -- platform-style-
// personas/preview has none (Plan 037, platform personas are global). Mirrors checkRateLimit's
// in-memory approach above instead: same one-process-only caveat, same low-stakes tradeoff for a
// preview button.
//
// Falls back to a random key when the client sends none, exactly like the sync route -- until PR
// 3/3's frontend actually resends the same key on retry, every call gets its own random key and
// this is a no-op, so today's behavior is unchanged.
export function resolvePreviewIdempotencyKey(request: FastifyRequest): string | null {
  const header = request.headers['idempotency-key']
  if (Array.isArray(header)) return null
  const parsed = PreviewIdempotencyKeySchema.safeParse(header ?? randomUUID())
  return parsed.success ? parsed.data : null
}

const previewByIdempotencyKey = new Map<string, { promise: Promise<StyleProfilePreviewResult>; expiresAt: number }>()
let nextPreviewSweepAt = 0
const PREVIEW_DEDUPE_WINDOW_MS = 120_000

export async function previewStyleProfile(
  supabaseClients: SupabaseClientFactory,
  environment: ApiEnvironment,
  input: { name: string; description: string; styleRules: StyleProfileRules; avoidRules: readonly string[]; doRules: readonly string[]; sampleInput: string },
  idempotencyKey: string,
  generatorOverride?: StructuredContentGenerator,
): Promise<StyleProfilePreviewResult> {
  const now = Date.now()
  if (previewByIdempotencyKey.size > 1_000 && now >= nextPreviewSweepAt) {
    nextPreviewSweepAt = now + 60_000
    for (const [key, entry] of previewByIdempotencyKey) {
      if (entry.expiresAt < now) previewByIdempotencyKey.delete(key)
    }
  }
  const existing = previewByIdempotencyKey.get(idempotencyKey)
  if (existing && existing.expiresAt >= now) return existing.promise
  const promise = runStyleProfilePreview(supabaseClients, environment, input, generatorOverride)
  previewByIdempotencyKey.set(idempotencyKey, { promise, expiresAt: now + PREVIEW_DEDUPE_WINDOW_MS })
  return promise
}

async function runStyleProfilePreview(
  supabaseClients: SupabaseClientFactory,
  environment: ApiEnvironment,
  input: { name: string; description: string; styleRules: StyleProfileRules; avoidRules: readonly string[]; doRules: readonly string[]; sampleInput: string },
  generatorOverride?: StructuredContentGenerator,
): Promise<StyleProfilePreviewResult> {
  const service = supabaseClients.forService()
  // Seit 2026081305 vergibt eine aktive Aufgabenart jede Prioritaet nur einmal -- die vorderste
  // Zeile ist damit eindeutig, und die frueher hier noetige Gleichstandspruefung (zwei Zeilen
  // laden, bei gleicher Prioritaet abbrechen) kann nicht mehr greifen. Sie haette den Konflikt
  // ohnehin erst hier gemeldet, wo ihn niemand mehr aufloesen kann, und dazu unter dem Namen
  // text_provider_not_configured -- der Konflikt scheitert jetzt beim Speichern in der
  // Provider-Verwaltung (POST/PATCH /v1/llm-providers, 409 priority_already_taken).
  const configs = await service
    .from('llm_provider_configurations')
    .select('id, protocol, base_url, model, temperature, max_output_tokens, structured_output_required, llm_provider_secrets!inner(api_key_ciphertext, key_version)')
    .eq('task_kind', 'text_generation').eq('is_active', true).order('priority').limit(1)
  if (configs.error) throw configs.error
  const rows = configs.data as Record<string, unknown>[]
  if (rows.length === 0) {
    return { ok: false, status: 422, error: 'text_provider_not_configured' }
  }
  const row = ActiveTextProviderRowSchema.parse(rows[0])
  const generator = generatorOverride ?? PREVIEW_TEXT_GENERATORS[row.protocol]
  if (!generator || !row.structured_output_required) {
    return { ok: false, status: 422, error: 'unsupported_provider_configuration' }
  }
  const secret = Array.isArray(row.llm_provider_secrets) ? row.llm_provider_secrets[0]! : row.llm_provider_secrets
  const apiKey = createSecretBoxFromEnvironment(environment).open(byteaToBuffer(secret.api_key_ciphertext), secret.key_version, row.id)
  // No preset exists for a preview -- built by hand instead of createTextGroundedContentBrief,
  // which requires a real registered preset slug. sampleInput is the sole allowedClaim, exactly
  // as sourceMaterial.facts/observations feed allowedClaims for a real submission.
  const brief: GroundedContentBrief = {
    allowedClaims: [{ sourceId: 'sample', text: input.sampleInput }],
    approvedQuotes: [], missingFacts: [], prohibitedClaims: [],
    goal: 'inform', requestedFormats: [], presetSlug: 'preview',
  }
  try {
    const post = await generator.generateText({
      brief,
      styleProfile: { name: input.name, description: input.description, styleRules: input.styleRules, avoidRules: [...input.avoidRules], doRules: [...input.doRules] },
      model: row.model, baseUrl: row.base_url, apiKey, temperature: row.temperature, maxOutputTokens: row.max_output_tokens,
      // Kuerzer als die 60 s des Adapters (packages/content-engine): der Worker darf so lange
      // warten, weil dort niemand an einer offenen HTTP-Verbindung haengt -- hier wartet ein
      // Browser auf den "Testen"-Knopf, und jede wartende Anfrage haelt eine Verbindung.
      requestTimeoutMs: 30_000,
    })
    return { ok: true, post }
  } catch (error) {
    if (error instanceof ContentGenerationError) {
      return { ok: false, status: error.errorClass === 'provider_rate_limit' ? 429 : 502, error: error.errorClass }
    }
    throw error
  }
}
