import { BRAND_LOCKABLE_FIELDS, type BrandLockableField } from '@vereinsfunk/domain'
import {
  ClubEventSchema,
  DirectoryPersonSchema,
  FixtureSchema,
  IntegrationSourceSchema,
  IntegrationSyncConflictSchema,
  IntegrationSyncRunSchema,
  type ScopeLevel,
} from '@vereinsfunk/contracts'

const PROFILE_UPDATE_COLUMNS: Record<string, string> = {
  legalName: 'legal_name',
  legalForm: 'legal_form',
  registerCourt: 'register_court',
  registerNumber: 'register_number',
  street: 'street',
  houseNumber: 'house_number',
  postalCode: 'postal_code',
  city: 'city',
  countryCode: 'country_code',
  contactEmail: 'contact_email',
  contactPhone: 'contact_phone',
  websiteUrl: 'website_url',
  foundedYear: 'founded_year',
  responsiblePersonProfileId: 'responsible_person_profile_id',
  imprintPublished: 'imprint_published',
}

export function toProfileUpdatePayload(input: Record<string, unknown>): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  for (const [key, column] of Object.entries(PROFILE_UPDATE_COLUMNS)) {
    if (key in input) payload[column] = input[key]
  }
  return payload
}

export function mapProfileRow(row: Record<string, unknown>) {
  const mapped: Record<string, unknown> = { organizationId: row.organization_id }
  for (const [key, column] of Object.entries(PROFILE_UPDATE_COLUMNS)) mapped[key] = row[column]
  return mapped
}

export function mapBrandRow(row: Record<string, unknown>) {
  return {
    organizationId: row.organization_id, primaryColor: row.primary_color, accentColor: row.accent_color,
    backgroundColor: row.background_color, textColor: row.text_color, onPrimaryColor: row.on_primary_color,
    tone: row.tone, displayFontKey: row.display_font_key, bodyFontKey: row.body_font_key,
    displayFontAssetId: row.display_font_asset_id, bodyFontAssetId: row.body_font_asset_id,
    allowDepartmentOverrides: row.allow_department_overrides, lockedFields: row.locked_fields,
    logoPath: row.logo_path, logoDarkPath: row.logo_dark_path,
  }
}

export function mapBrandAssetRow(row: Record<string, unknown>) {
  return {
    id: row.id, organizationId: row.organization_id, departmentId: row.department_id, teamId: row.team_id,
    kind: row.kind, objectPath: row.object_path, mimeType: row.mime_type, byteSize: row.byte_size,
    width: row.width, height: row.height, fontFamily: row.font_family, fontWeight: row.font_weight,
    fontStyle: row.font_style, licenseHolder: row.license_holder, licenseNote: row.license_note,
    licenseConfirmedAt: row.license_confirmed_at, status: row.status, rejectionReason: row.rejection_reason,
    createdAt: row.created_at,
  }
}

export function mapDepartmentBrandRow(row: Record<string, unknown>) {
  return {
    organizationId: row.organization_id, departmentId: row.department_id, primaryColor: row.primary_color,
    accentColor: row.accent_color, tone: row.tone, logoAssetId: row.logo_asset_id,
    displayFontAssetId: row.display_font_asset_id, bodyFontAssetId: row.body_font_asset_id,
    allowTeamOverrides: row.allow_team_overrides, lockedFields: row.locked_fields,
  }
}

export function mapTeamBrandRow(row: Record<string, unknown>) {
  return {
    organizationId: row.organization_id, departmentId: row.department_id, teamId: row.team_id,
    primaryColor: row.primary_color, accentColor: row.accent_color, tone: row.tone,
    logoAssetId: row.logo_asset_id, displayFontAssetId: row.display_font_asset_id,
    bodyFontAssetId: row.body_font_asset_id,
  }
}

type BrandOverrideInput = Partial<Record<BrandLockableField, string | null | undefined>>

export function firstBlockedBrandField(input: BrandOverrideInput, lockedFields: readonly string[]): BrandLockableField | null {
  const locked = new Set(lockedFields)
  for (const field of BRAND_LOCKABLE_FIELDS) {
    const value = input[field]
    if (value !== undefined && value !== null && locked.has(field)) return field
  }
  return null
}

export function setsAnyBrandField(input: BrandOverrideInput): boolean {
  return BRAND_LOCKABLE_FIELDS.some((field) => input[field] !== undefined && input[field] !== null)
}

export function mapDepartmentRow(row: Record<string, unknown>) {
  return { id: row.id, organizationId: row.organization_id, name: row.name, slug: row.slug, archivedAt: row.archived_at, createdAt: row.created_at }
}

export function mapTeamRow(row: Record<string, unknown>) {
  return {
    id: row.id, organizationId: row.organization_id, departmentId: row.department_id, name: row.name,
    ageGroup: row.age_group ?? null, competition: row.competition ?? null, sourceId: row.source_id ?? null,
    archivedAt: row.archived_at, createdAt: row.created_at,
  }
}

export function mapChannelScopeRow(row: Record<string, unknown>, organizationId: string) {
  return { id: row.id, scope: row.scope, scopeId: row.team_id ?? row.department_id ?? organizationId, canSchedule: row.can_schedule }
}

export function mapSocialConnectionRow(row: Record<string, unknown>) {
  return {
    id: row.id, platform: row.platform, externalAccountId: row.external_account_id, displayName: row.display_name,
    status: row.status, tokenExpiresAt: row.token_expires_at, lastVerifiedAt: row.last_verified_at,
    ownerScope: row.owner_scope, ownerDepartmentId: row.owner_department_id,
    responsibleProfileId: row.responsible_profile_id, purpose: row.purpose, confidential: row.confidential,
    archivedAt: row.archived_at, createdAt: row.created_at, imprintUrl: row.imprint_url,
    privacyUrl: row.privacy_url, editorialResponsibleProfileId: row.editorial_responsible_profile_id,
    editorialResponsibleNote: row.editorial_responsible_note,
  }
}

export function metaRedirectUri(redirectBaseUrl: string, platform: 'instagram' | 'facebook'): string {
  return new URL(`/v1/channels/connect/${platform}/callback`, redirectBaseUrl).toString()
}

export function mapInvitationRow(row: Record<string, unknown>) {
  return {
    id: row.id, organizationId: row.organization_id, departmentId: row.department_id, teamId: row.team_id,
    email: row.email, role: row.role, invitedBy: row.invited_by, expiresAt: row.expires_at,
    acceptedAt: row.accepted_at, revokedAt: row.revoked_at, lastSentAt: row.last_sent_at,
    sendCount: row.send_count, createdAt: row.created_at,
  }
}

export function membershipTableFor(scope: ScopeLevel): 'organization_memberships' | 'department_memberships' | 'team_memberships' {
  return scope === 'organization' ? 'organization_memberships' : scope === 'department' ? 'department_memberships' : 'team_memberships'
}

// --- Paket 014/019: Integrationen, Spielplaene und Veranstaltungen ---------------------------
// Hier statt in einem einzelnen Route-Modul, weil jede dieser Zeilenformen von mindestens zwei
// Modulen gelesen wird: Spiele/Veranstaltungen von routes/clubSchedule.ts und routes/content.ts
// (Faktenherkunft einer Einreichung), die drei Integrationsformen von routes/integrations.ts und
// services/integrationSync.ts.

export function mapIntegrationSourceRow(row: Record<string, unknown>) {
  return IntegrationSourceSchema.parse({
    id: row.id, organizationId: row.organization_id, transport: row.transport, providerKey: row.provider_key,
    displayName: row.display_name, enabledDomains: row.enabled_domains, departmentId: row.department_id,
    endpointUrl: row.endpoint_url, fieldMapping: row.field_mapping, syncCron: row.sync_cron,
    lossThresholdPercent: row.loss_threshold_percent, enabled: row.enabled, lastSyncAt: row.last_sync_at,
    lastSyncStatus: row.last_sync_status, createdAt: row.created_at,
  })
}

export function mapSyncRunRow(row: Record<string, unknown>) {
  return IntegrationSyncRunSchema.parse({
    id: row.id, organizationId: row.organization_id, sourceId: row.source_id, domain: row.domain, mode: row.mode,
    status: row.status, createdCount: row.created_count, updatedCount: row.updated_count, retiredCount: row.retired_count,
    skippedCount: row.skipped_count, conflictCount: row.conflict_count, errorClass: row.error_class,
    startedAt: row.started_at, finishedAt: row.finished_at,
  })
}

export function mapSyncConflictRow(row: Record<string, unknown>) {
  return IntegrationSyncConflictSchema.parse({
    id: row.id, organizationId: row.organization_id, syncRunId: row.sync_run_id, sourceId: row.source_id, domain: row.domain,
    externalId: row.external_id, localId: row.local_id, label: row.label, field: row.field, currentValue: row.current_value,
    incomingValue: row.incoming_value, kind: row.kind, resolution: row.resolution, resolvedAt: row.resolved_at, createdAt: row.created_at,
  })
}

export function mapFixtureRow(row: Record<string, unknown>) {
  return FixtureSchema.parse({
    id: row.id, organizationId: row.organization_id, departmentId: row.department_id, teamId: row.team_id,
    kind: row.kind, competition: row.competition, isHome: row.is_home, ownTeamLabel: row.own_team_label,
    opponentName: row.opponent_name, kickoffAt: row.kickoff_at, kickoffTimeConfirmed: row.kickoff_time_confirmed,
    venueName: row.venue_name, venueAddress: row.venue_address, status: row.status,
    homeScore: row.home_score, awayScore: row.away_score, note: row.note,
    announcementDismissedAt: row.announcement_dismissed_at, resultDismissedAt: row.result_dismissed_at,
    sourceId: row.source_id, sourceUpdatedAt: row.source_updated_at, createdAt: row.created_at, updatedAt: row.updated_at,
  })
}

export function mapClubEventRow(row: Record<string, unknown>) {
  return ClubEventSchema.parse({
    id: row.id, organizationId: row.organization_id, departmentId: row.department_id, teamId: row.team_id,
    title: row.title, description: row.description, category: row.category,
    startsAt: row.starts_at, endsAt: row.ends_at, allDay: row.all_day,
    locationName: row.location_name, locationAddress: row.location_address, registrationUrl: row.registration_url,
    status: row.status, invitationDismissedAt: row.invitation_dismissed_at,
    sourceId: row.source_id, sourceUpdatedAt: row.source_updated_at, createdAt: row.created_at, updatedAt: row.updated_at,
  })
}

export function mapDirectoryPersonRow(row: Record<string, unknown>) {
  return DirectoryPersonSchema.parse({
    id: row.id, organizationId: row.organization_id, departmentId: row.department_id, teamId: row.team_id,
    firstName: row.first_name, lastName: row.last_name, birthYear: row.birth_year, isMinor: row.is_minor,
    status: row.status, leftAt: row.left_at, joinedAt: row.joined_at, profileId: row.profile_id,
    becameAdultAt: row.became_adult_at, sourceId: row.source_id, createdAt: row.created_at,
  })
}

// Spalten dieser beiden Zeilenformen, damit Leser und Schreiber nicht auseinanderlaufen: die
// Auswahl steht sonst wortgleich in bis zu vier Routen je Tabelle.
export const FIXTURE_COLUMNS =
  'id, organization_id, department_id, team_id, kind, competition, is_home, own_team_label, opponent_name, kickoff_at, kickoff_time_confirmed, venue_name, venue_address, status, home_score, away_score, note, announcement_dismissed_at, result_dismissed_at, source_id, source_updated_at, created_at, updated_at'
export const CLUB_EVENT_COLUMNS =
  'id, organization_id, department_id, team_id, title, description, category, starts_at, ends_at, all_day, location_name, location_address, registration_url, status, invitation_dismissed_at, source_id, source_updated_at, created_at, updated_at'
export const INTEGRATION_SOURCE_COLUMNS =
  'id, organization_id, transport, provider_key, display_name, enabled_domains, department_id, endpoint_url, field_mapping, sync_cron, loss_threshold_percent, enabled, last_sync_at, last_sync_status, created_at'
export const SYNC_RUN_COLUMNS =
  'id, organization_id, source_id, domain, mode, status, created_count, updated_count, retired_count, skipped_count, conflict_count, error_class, started_at, finished_at'
export const SYNC_CONFLICT_COLUMNS =
  'id, organization_id, sync_run_id, source_id, domain, external_id, local_id, label, field, current_value, incoming_value, kind, resolution, resolved_at, created_at'
export const DIRECTORY_PERSON_COLUMNS =
  'id, organization_id, department_id, team_id, first_name, last_name, birth_year, is_minor, status, left_at, joined_at, profile_id, became_adult_at, source_id, created_at'
