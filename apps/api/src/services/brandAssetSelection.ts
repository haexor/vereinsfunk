import { BrandLogoAssetKindSchema } from '@vereinsfunk/contracts'
import { isBrandAssetSelectable, type BrandAssetRef } from '@vereinsfunk/domain'
import type { SupabaseClient } from '@supabase/supabase-js'
import { scopeLevelOf, type ScopeIds } from './scopeAuthorization.js'

// Ob eine Zeile mit eigener Besitzebene (Brand-Asset, Bildstil- oder Layout-Preset) im Ziel-Scope
// waehlbar ist: auf derselben oder einer uebergeordneten Ebene (siehe isBrandAssetSelectable).
export function isSelectableInScope(owner: ScopeIds, target: ScopeIds): boolean {
  const asset: BrandAssetRef = {
    scope: scopeLevelOf(owner),
    ...(owner.departmentId ? { departmentId: owner.departmentId } : {}),
    ...(owner.teamId ? { teamId: owner.teamId } : {}),
  }
  return isBrandAssetSelectable(
    asset,
    scopeLevelOf(target),
    target.departmentId ?? undefined,
    target.teamId ?? undefined,
  )
}

// Waehlbarkeits-Vorabpruefung fuer Markenprofile (logoAssetId/displayFontAssetId/bodyFontAssetId)
// und Bildstil-Presets (frame_brand_asset_id/logo_brand_asset_id, Plan 045, PR 1) -- die DB-CHECK
// (authz.brand_asset_is_selectable in der RLS-Policy) bleibt die eigentliche Sicherheitsgrenze,
// dieser Aufruf liefert nur die fruehere, freundlichere 400-Antwort.
export async function loadSelectableBrandAsset(
  client: SupabaseClient,
  organizationId: string,
  assetId: string,
  target: ScopeIds,
): Promise<{ id: string; kind: string } | null> {
  const result = await client
    .from('brand_assets')
    .select('id, kind, department_id, team_id, status')
    .eq('organization_id', organizationId)
    .eq('id', assetId)
    .maybeSingle()
  if (result.error) throw result.error
  if (!result.data || result.data.status !== 'ready') return null
  const owner = { departmentId: result.data.department_id as string | null, teamId: result.data.team_id as string | null }
  if (!isSelectableInScope(owner, target)) return null
  return { id: result.data.id as string, kind: result.data.kind as string }
}

// Prueft jede gesetzte Asset-Referenz eines Markenprofils oder Presets: 'ready', im Ziel-Scope
// waehlbar und von einer der erwarteten Arten. Nicht gesetzte Referenzen (null/undefined) zaehlen
// als gueltig.
export async function validateBrandAssetReferences(
  client: SupabaseClient,
  organizationId: string,
  target: ScopeIds,
  references: readonly (readonly [assetId: string | null | undefined, expectedKinds: ReadonlySet<string>])[],
): Promise<boolean> {
  for (const [assetId, expectedKinds] of references) {
    if (!assetId) continue
    const asset = await loadSelectableBrandAsset(client, organizationId, assetId, target)
    if (!asset || !expectedKinds.has(asset.kind)) return false
  }
  return true
}

// Von Markenprofil und Bildstil-Nachbesserung gleichermassen gebraucht: logo_brand_asset_id ist
// seit der Lockerung des Fremdschluessels (2026082002) nicht mehr auf kind='watermark' gepinnt,
// sondern akzeptiert jede hier gelistete Logovariante.
export const LOGO_ASSET_KINDS = new Set<string>(BrandLogoAssetKindSchema.options)
