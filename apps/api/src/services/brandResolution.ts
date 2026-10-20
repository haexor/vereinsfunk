import {
  resolveBrand,
  type BrandOverrideProfile,
  type DepartmentBrandLevel,
  type OrganizationBrandLevel,
} from '@vereinsfunk/domain'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { parseSupabaseData } from '../supabase.js'
import {
  mapBrandRow,
  mapDepartmentBrandRow,
  mapTeamBrandRow,
} from '../apiMappers.js'

const BrandAssetPathRowSchema = z.object({ object_path: z.string().min(1) })

export class BrandAssetNotReadyError extends Error {
  constructor() {
    super('brand_asset_not_ready')
  }
}

export async function downloadBrandAssetBuffer(
  service: SupabaseClient,
  organizationId: string,
  assetId: string,
): Promise<Buffer> {
  const asset = await service
    .from('brand_assets')
    .select('object_path')
    .eq('id', assetId)
    .eq('organization_id', organizationId)
    .eq('status', 'ready')
    .maybeSingle()
  if (asset.error) throw asset.error
  if (!asset.data) throw new BrandAssetNotReadyError()
  const download = await service.storage
    .from('brand-assets')
    .download(parseSupabaseData(BrandAssetPathRowSchema, asset.data).object_path)
  if (download.error) throw download.error
  return Buffer.from(await download.data.arrayBuffer())
}

// Die fuer den parametrischen Rahmen und den Duoton-Filter tatsaechlich wirksame Vereinsfarbe --
// dieselbe Vererbungskette (Verein -> Abteilung -> Mannschaft) wie packages/domain's resolveBrand
// sie fuer die Marke-Seite schon aufloest, hier fuer die Zielebene des Beitrags statt fuer eine
// gerade aktive UI-Ebene.
// Auch die Bildkomposition (routes/photoLayout.ts, Plan 047, PR 1) braucht dieselbe Vereinsfarben-
// Aufloesung fuer ihre Trennlinien-/Gutter-Farbe -- kein zweiter Aufruf derselben drei Abfragen.
export async function loadResolvedBrandColors(
  service: SupabaseClient,
  organizationId: string,
  departmentId: string | null,
  teamId: string | null,
): Promise<{ primaryColor: string; accentColor: string }> {
  const [orgRow, deptRow, teamRow] = await Promise.all([
    service
      .from('organization_brand_profiles')
      .select()
      .eq('organization_id', organizationId)
      .maybeSingle(),
    departmentId
      ? service
          .from('department_brand_profiles')
          .select()
          .eq('organization_id', organizationId)
          .eq('department_id', departmentId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    teamId
      ? service
          .from('team_brand_profiles')
          .select()
          .eq('organization_id', organizationId)
          .eq('team_id', teamId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])
  if (orgRow.error) throw orgRow.error
  if (deptRow.error) throw deptRow.error
  if (teamRow.error) throw teamRow.error

  // mapBrandRow/mapDepartmentBrandRow tragen allowDepartmentOverrides/allowTeamOverrides und
  // lockedFields bereits selbst -- sie hier noch einmal von Hand anzuhaengen war reine Doppelung
  // (locked_fields ist ausserdem `not null default '{}'`, der Ersatzwert lief also ins Leere).
  const organization = orgRow.data
    ? (mapBrandRow(orgRow.data) as unknown as OrganizationBrandLevel)
    : { allowDepartmentOverrides: true, lockedFields: [] }
  const department = deptRow.data
    ? (mapDepartmentBrandRow(deptRow.data) as unknown as DepartmentBrandLevel)
    : null
  const team = teamRow.data
    ? (mapTeamBrandRow(teamRow.data) as unknown as BrandOverrideProfile)
    : null

  const resolved = resolveBrand(organization, department, team)
  return { primaryColor: resolved.primaryColor, accentColor: resolved.accentColor }
}
