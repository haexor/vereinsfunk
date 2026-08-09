import { BRAND_LOCKABLE_FIELDS, type BrandLockableField } from '@vereinsfunk/domain'
import type { ScopeLevel } from '@vereinsfunk/contracts'

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
