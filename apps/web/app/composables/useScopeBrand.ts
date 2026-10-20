import type { Ref } from 'vue'
import { BrandAssetRowSchema, DepartmentBrandRowSchema, OrganizationBrandRowSchema } from '../utils/brandPageRows'
import { resolveSidebarLogoAsset } from '../utils/sidebarLogo'
import type { ActiveScope } from './useScope'

const DEFAULT_SCOPE_BRAND = { primaryColor: '#163a2c', accentColor: '#caff4a' }
const BRAND_COLUMNS = { primary_color: true, accent_color: true, logo_asset_id: true } as const
const OrganizationScopeBrandRowSchema = OrganizationBrandRowSchema.pick(BRAND_COLUMNS)
const DepartmentScopeBrandRowSchema = DepartmentBrandRowSchema.pick(BRAND_COLUMNS)
const SidebarLogoRowSchema = BrandAssetRowSchema.pick({
  id: true, department_id: true, team_id: true, kind: true, object_path: true, status: true,
})

// Paket 013, Rueckbau: das Vereinslogo ersetzt die Initialen dort, wo der Verein tatsaechlich
// als Marke auftritt -- die kleine Kachel im Umschalter der Sidebar, nicht die geteilte
// AppLogo-Komponente. AppLogo bleibt bewusst unveraendert: sie steht auch in layouts/admin.vue und
// layouts/auth.vue, wo es keinen (oder noch keinen einzelnen) aktiven Verein gibt -- dort waere ein
// Vereinslogo fachlich falsch, es ist die Produktmarke "vereinsfunk", nicht die des Vereins.
export function useScopeBrand(scope: Ref<ActiveScope | null>) {
  const { revision } = useBrandRevision()
  const logoUrl = ref('')
  const brand = ref<{ primaryColor: string; accentColor: string }>({ ...DEFAULT_SCOPE_BRAND })
  // Lauf-Pruefung statt reiner organizationId-Pruefung: bei A -> B -> A stimmt organizationId beim
  // dritten Lauf wieder mit dem ersten ueberein, ein spaet zurueckkehrender erster Lauf wuerde die
  // Pruefung also bestehen und das (moeglicherweise veraltete) Ergebnis des dritten Laufs
  // ueberschreiben. Jeder Watcher-Aufruf beginnt einen eigenen Lauf, unabhaengig vom Zielverein.
  const runs = useLatestRequest()
  watch(
    () => [scope.value?.organizationId, scope.value?.departmentId, revision.value] as const,
    async ([organizationId, departmentId]) => {
      const isLatest = runs.begin()
      logoUrl.value = ''
      brand.value = { ...DEFAULT_SCOPE_BRAND }
      if (!organizationId) return
      const supabase = useSupabaseClient()
      const organizationBrand = await supabase
        .from('organization_brand_profiles')
        .select('primary_color, accent_color, logo_asset_id')
        .eq('organization_id', organizationId)
        .maybeSingle()
      const organizationRow = OrganizationScopeBrandRowSchema.nullable().safeParse(organizationBrand.data)
      if (!isLatest() || !organizationRow.success || !organizationRow.data) return
      let resolved = {
        primaryColor: organizationRow.data.primary_color,
        accentColor: organizationRow.data.accent_color,
        logoAssetId: organizationRow.data.logo_asset_id,
      }
      if (departmentId) {
        const departmentBrand = await supabase
          .from('department_brand_profiles')
          .select('primary_color, accent_color, logo_asset_id')
          .eq('department_id', departmentId)
          .maybeSingle()
        if (!isLatest()) return
        // Eine ungueltige Abteilungszeile ueberschreibt nichts -- die Shell zeigt dann die
        // Vereinsmarke statt fremder Werte.
        const departmentRow = DepartmentScopeBrandRowSchema.nullable().safeParse(departmentBrand.data)
        if (departmentRow.success && departmentRow.data) {
          resolved = {
            primaryColor: departmentRow.data.primary_color ?? resolved.primaryColor,
            accentColor: departmentRow.data.accent_color ?? resolved.accentColor,
            logoAssetId: departmentRow.data.logo_asset_id ?? resolved.logoAssetId,
          }
        }
      }
      brand.value = resolved
      // Das aktiv verknuepfte Logo bleibt die erste Wahl. Wurde eine passende Logo-Datei bereits
      // hochgeladen, aber auf /marke noch nicht als Render-Logo gespeichert, zeigt die Shell sie
      // trotzdem als Identitaet des aktuellen Bereichs. So bleibt der Kontext eindeutig, ohne die
      // fachliche, explizite Verknuepfung fuer Beitraege zu veraendern.
      const logoAssets = await supabase
        .from('brand_assets')
        .select('id, department_id, team_id, kind, object_path, status')
        .eq('organization_id', organizationId)
        .eq('status', 'ready')
        .in('kind', ['logo_primary', 'logo_light', 'logo_dark', 'logo_mark'])
        .order('created_at', { ascending: false })
      if (!isLatest() || logoAssets.error) return
      const logoRows = SidebarLogoRowSchema.array().safeParse(logoAssets.data)
      if (!logoRows.success) return
      const asset = resolveSidebarLogoAsset(
        logoRows.data.map((item) => ({
          id: item.id,
          departmentId: item.department_id,
          teamId: item.team_id,
          kind: item.kind,
          objectPath: item.object_path,
          status: item.status,
        })),
        departmentId ?? null,
        resolved.logoAssetId,
      )
      if (!asset) return
      const signed = await supabase.storage
        .from('brand-assets')
        .createSignedUrl(asset.objectPath, 600)
      if (!isLatest()) return
      logoUrl.value = signed.data?.signedUrl ?? ''
    },
    { immediate: true },
  )

  return { brand, logoUrl }
}
