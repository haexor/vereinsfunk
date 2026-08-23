import {
  BrandAssetSchema,
  DepartmentBrandSchema,
  OrganizationBrandSchema,
  TeamBrandSchema,
} from '@vereinsfunk/contracts'
import { z } from 'zod'

// Supabase liefert an dieser Grenze untypisierte Daten. Die Row-Schemas validieren die
// snake_case-Form bereits vor jeder Zustandsübernahme; die einzelnen Feldschemas stammen aus den
// öffentlichen Contracts, damit API- und Browsergrenze dieselben Werte akzeptieren.
const OrganizationBrandRowSchema = z.object({
  primary_color: OrganizationBrandSchema.shape.primaryColor,
  accent_color: OrganizationBrandSchema.shape.accentColor,
  background_color: OrganizationBrandSchema.shape.backgroundColor,
  text_color: OrganizationBrandSchema.shape.textColor,
  on_primary_color: OrganizationBrandSchema.shape.onPrimaryColor,
  display_font_key: OrganizationBrandSchema.shape.displayFontKey,
  body_font_key: OrganizationBrandSchema.shape.bodyFontKey,
  display_font_asset_id: OrganizationBrandSchema.shape.displayFontAssetId,
  body_font_asset_id: OrganizationBrandSchema.shape.bodyFontAssetId,
  logo_asset_id: OrganizationBrandSchema.shape.logoAssetId,
  website_url: OrganizationBrandSchema.shape.websiteUrl,
  allow_department_overrides: OrganizationBrandSchema.shape.allowDepartmentOverrides,
  locked_fields: OrganizationBrandSchema.shape.lockedFields,
})
const DepartmentRowSchema = z.object({
  id: DepartmentBrandSchema.shape.departmentId,
  name: z.string(),
})
const TeamRowSchema = z.object({
  id: TeamBrandSchema.shape.teamId,
  name: z.string(),
  department_id: DepartmentBrandSchema.shape.departmentId,
})
const DepartmentBrandRowSchema = z.object({
  department_id: DepartmentBrandSchema.shape.departmentId,
  primary_color: DepartmentBrandSchema.shape.primaryColor.nonoptional(),
  accent_color: DepartmentBrandSchema.shape.accentColor.nonoptional(),
  logo_asset_id: DepartmentBrandSchema.shape.logoAssetId.nonoptional(),
  website_url: DepartmentBrandSchema.shape.websiteUrl.nonoptional(),
  display_font_asset_id: DepartmentBrandSchema.shape.displayFontAssetId.nonoptional(),
  body_font_asset_id: DepartmentBrandSchema.shape.bodyFontAssetId.nonoptional(),
  allow_team_overrides: DepartmentBrandSchema.shape.allowTeamOverrides,
  locked_fields: DepartmentBrandSchema.shape.lockedFields,
})
const TeamBrandRowSchema = z.object({
  team_id: TeamBrandSchema.shape.teamId,
  primary_color: TeamBrandSchema.shape.primaryColor.nonoptional(),
  accent_color: TeamBrandSchema.shape.accentColor.nonoptional(),
  logo_asset_id: TeamBrandSchema.shape.logoAssetId.nonoptional(),
  display_font_asset_id: TeamBrandSchema.shape.displayFontAssetId.nonoptional(),
  body_font_asset_id: TeamBrandSchema.shape.bodyFontAssetId.nonoptional(),
})
const BrandAssetRowSchema = z.object({
  id: BrandAssetSchema.shape.id,
  department_id: BrandAssetSchema.shape.departmentId,
  team_id: BrandAssetSchema.shape.teamId,
  kind: BrandAssetSchema.shape.kind,
  object_path: BrandAssetSchema.shape.objectPath,
  status: BrandAssetSchema.shape.status,
  font_family: BrandAssetSchema.shape.fontFamily,
  font_weight: BrandAssetSchema.shape.fontWeight,
  font_style: BrandAssetSchema.shape.fontStyle,
  license_holder: BrandAssetSchema.shape.licenseHolder,
  created_at: BrandAssetSchema.shape.createdAt,
})

export const BrandPageRowsSchema = z.object({
  brand: OrganizationBrandRowSchema.nullable(),
  departments: DepartmentRowSchema.array(),
  teams: TeamRowSchema.array(),
  departmentProfiles: DepartmentBrandRowSchema.array(),
  teamProfiles: TeamBrandRowSchema.array(),
  assets: BrandAssetRowSchema.array(),
})
