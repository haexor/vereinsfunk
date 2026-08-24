export interface SidebarLogoAsset {
  id: string
  departmentId: string | null
  teamId: string | null
  kind: string
  objectPath: string
  status: string
}

const LOGO_KINDS = new Set(['logo_primary', 'logo_light', 'logo_dark', 'logo_mark'])

function isReadyLogo(asset: SidebarLogoAsset) {
  return asset.status === 'ready' && LOGO_KINDS.has(asset.kind)
}

// Die Logo-Verknuepfung ist fuer Renderings bewusst explizit: dort darf eine Auswahl nie
// stillschweigend wechseln. In der Navigations-Shell ist es dagegen hilfreicher, eine bereits
// hochgeladene Marken-Datei zu zeigen als auf Initialen zurueckzufallen. Die Auswahl veraendert
// keine Daten und bevorzugt deshalb immer eine explizite Verknuepfung vor der neuesten Datei.
export function resolveSidebarLogoAsset(
  assets: readonly SidebarLogoAsset[],
  departmentId: string | null,
  selectedLogoAssetId: string | null,
): SidebarLogoAsset | null {
  const readyLogos = assets.filter(isReadyLogo)
  const selected = selectedLogoAssetId
    ? readyLogos.find((asset) => asset.id === selectedLogoAssetId)
    : undefined
  if (selected) return selected

  if (departmentId) {
    const departmentLogo = readyLogos.find(
      (asset) => asset.departmentId === departmentId && asset.teamId === null,
    )
    if (departmentLogo) return departmentLogo
  }

  return readyLogos.find((asset) => asset.departmentId === null && asset.teamId === null) ?? null
}
