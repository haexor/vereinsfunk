import type { ComputedRef } from 'vue'
import type { ActiveScopeLevel } from './useActiveScope'
import type { BrandAssetRow, BrandOrganizationState } from './useBrandAssets'
import type { useBrandOverrides } from './useBrandOverrides'
import { ApiRequestError } from '../utils/apiClient'
import { BrandPageRowsSchema } from '../utils/brandPageRows'

/**
 * Laden und Speichern der Markenseite: Vereinsmarke, Abteilungs-/Mannschaftsprofile und die
 * Asset-Bibliothek kommen in einem Lauf aus Supabase, gespeichert wird ueber die API fuer die
 * aktive Ebene. Formularzustand (org, Overrides) gehoert hierher, weil jedes Laden ihn ersetzt.
 */
export function useBrandPageData({
  api,
  supabase,
  organizationId,
  activeLevel,
  activeDepartmentId,
  overrides,
  onAssetsLoaded,
}: {
  api: ReturnType<typeof useApiClient>
  supabase: ReturnType<typeof useSupabaseClient>
  organizationId: ComputedRef<string | null>
  activeLevel: ComputedRef<ActiveScopeLevel>
  activeDepartmentId: ComputedRef<string | null>
  overrides: ReturnType<typeof useBrandOverrides>
  // Die Asset-Liste gehoert useBrandAssets, das seinerseits erst mit org und loadAll entsteht.
  onAssetsLoaded: (assets: BrandAssetRow[]) => void
}) {
  const { refreshBrandRevision } = useBrandRevision()
  const { departmentOverrides, teamOverrides, overrideFor } = overrides

  const loading = ref(true)
  const loadError = ref(false)
  const saving = ref(false)
  const errorMessage = ref('')
  const loadRuns = useLatestRequest()

  // Die Analyse darf erst nach dem Speichern starten. Diese Momentaufnahme trennt eine gerade
  // bearbeitete Eingabe klar von der URL, die die API tatsächlich aus dem Markenprofil liest.
  const savedBrandWebsiteUrls = ref<Record<string, string | null>>({})

  const org = reactive<BrandOrganizationState>({
    primaryColor: '#163a2c',
    accentColor: '#caff4a',
    backgroundColor: '#f6f4ec',
    textColor: '#122820',
    onPrimaryColor: '#ffffff',
    displayFontKey: 'manrope',
    bodyFontKey: 'dm_sans',
    displayFontAssetId: null,
    bodyFontAssetId: null,
    logoAssetId: null,
    websiteUrl: null,
    allowDepartmentOverrides: true,
    lockedFields: [],
  })

  // Sperren wirken nur nach unten (siehe packages/domain/src/brand.ts, resolveBrand): fuer die
  // Abteilung gelten die Sperren des Vereins.
  const lockedForActiveLevel = computed<Set<string>>(() => {
    const locked = new Set<string>()
    if (activeLevel.value === 'organization') return locked
    for (const field of org.lockedFields) locked.add(field)
    return locked
  })

  async function loadAll() {
    const isLatest = loadRuns.begin()
    if (!organizationId.value) {
      loading.value = false
      return
    }
    loading.value = true
    loadError.value = false
    try {
      const [
        brandResult,
        departmentsResult,
        teamsResult,
        departmentProfilesResult,
        teamProfilesResult,
        assetsResult,
      ] = await Promise.all([
        supabase
          .from('organization_brand_profiles')
          .select(
            'primary_color, accent_color, background_color, text_color, on_primary_color, display_font_key, body_font_key, display_font_asset_id, body_font_asset_id, logo_asset_id, website_url, allow_department_overrides, locked_fields',
          )
          .eq('organization_id', organizationId.value)
          .maybeSingle(),
        supabase
          .from('departments')
          .select('id, name')
          .eq('organization_id', organizationId.value)
          .is('archived_at', null)
          .order('name'),
        supabase
          .from('teams')
          .select('id, name, department_id')
          .eq('organization_id', organizationId.value)
          .is('archived_at', null)
          .order('name'),
        supabase
          .from('department_brand_profiles')
          .select(
            'department_id, primary_color, accent_color, logo_asset_id, website_url, display_font_asset_id, body_font_asset_id, allow_team_overrides, locked_fields',
          )
          .eq('organization_id', organizationId.value),
        supabase
          .from('team_brand_profiles')
          .select(
            'team_id, primary_color, accent_color, logo_asset_id, display_font_asset_id, body_font_asset_id',
          )
          .eq('organization_id', organizationId.value),
        supabase
          .from('brand_assets')
          .select(
            'id, department_id, team_id, kind, object_path, status, font_family, font_weight, font_style, license_holder, created_at',
          )
          .eq('organization_id', organizationId.value)
          .order('created_at', { ascending: false }),
      ])
      if (
        brandResult.error ||
        departmentsResult.error ||
        teamsResult.error ||
        departmentProfilesResult.error ||
        teamProfilesResult.error ||
        assetsResult.error
      ) {
        if (!isLatest()) return
        loadError.value = true
        return
      }
      if (!isLatest()) return
      const rows = BrandPageRowsSchema.safeParse({
        brand: brandResult.data,
        departments: departmentsResult.data,
        teams: teamsResult.data,
        departmentProfiles: departmentProfilesResult.data,
        teamProfiles: teamProfilesResult.data,
        assets: assetsResult.data,
      })
      if (!rows.success) {
        loadError.value = true
        return
      }
      if (rows.data.brand) {
        org.primaryColor = rows.data.brand.primary_color
        org.accentColor = rows.data.brand.accent_color
        org.backgroundColor = rows.data.brand.background_color
        org.textColor = rows.data.brand.text_color
        org.onPrimaryColor = rows.data.brand.on_primary_color
        org.displayFontKey = rows.data.brand.display_font_key
        org.bodyFontKey = rows.data.brand.body_font_key
        org.displayFontAssetId = rows.data.brand.display_font_asset_id
        org.bodyFontAssetId = rows.data.brand.body_font_asset_id
        org.logoAssetId = rows.data.brand.logo_asset_id
        org.websiteUrl = rows.data.brand.website_url
        org.allowDepartmentOverrides = rows.data.brand.allow_department_overrides
        org.lockedFields = rows.data.brand.locked_fields
      }
      const savedUrls: Record<string, string | null> = {
        [`organization:${organizationId.value}`]: rows.data.brand?.website_url ?? null,
      }
      departmentOverrides.value = {}
      for (const row of rows.data.departmentProfiles) {
        savedUrls[`department:${row.department_id}`] = row.website_url
        departmentOverrides.value[row.department_id] = {
          primaryColor: row.primary_color,
          accentColor: row.accent_color,
          logoAssetId: row.logo_asset_id,
          websiteUrl: row.website_url,
          displayFontAssetId: row.display_font_asset_id,
          bodyFontAssetId: row.body_font_asset_id,
          displayFontKey: null,
          bodyFontKey: null,
          allowTeamOverrides: row.allow_team_overrides,
          lockedFields: row.locked_fields,
        }
      }
      savedBrandWebsiteUrls.value = savedUrls
      teamOverrides.value = {}
      for (const row of rows.data.teamProfiles) {
        teamOverrides.value[row.team_id] = {
          primaryColor: row.primary_color,
          accentColor: row.accent_color,
          logoAssetId: row.logo_asset_id,
          displayFontAssetId: row.display_font_asset_id,
          bodyFontAssetId: row.body_font_asset_id,
          displayFontKey: null,
          bodyFontKey: null,
        }
      }
      onAssetsLoaded(rows.data.assets.map((row) => ({
        id: row.id,
        departmentId: row.department_id,
        teamId: row.team_id,
        kind: row.kind,
        objectPath: row.object_path,
        status: row.status,
        fontFamily: row.font_family,
        fontWeight: row.font_weight,
        fontStyle: row.font_style,
        licenseHolder: row.license_holder,
        createdAt: row.created_at,
      })))
      // Hat die aktive Ebene serverseitig noch kein Profil, muss der leere Eintrag hier neu
      // entstehen -- die Formularfelder schreiben direkt hinein, und ein computed darf ihn nicht
      // mehr nachtraeglich anlegen.
      if (activeLevel.value === 'department' && activeDepartmentId.value)
        overrideFor(activeDepartmentId.value)
    } finally {
      if (isLatest()) loading.value = false
    }
  }

  async function saveOrganization() {
    await api.request(`/v1/organizations/${organizationId.value}/brand`, {
      method: 'PUT',
      body: {
        primaryColor: org.primaryColor,
        accentColor: org.accentColor,
        displayFontKey: org.displayFontKey,
        bodyFontKey: org.bodyFontKey,
        displayFontAssetId: org.displayFontAssetId,
        bodyFontAssetId: org.bodyFontAssetId,
        logoAssetId: org.logoAssetId,
        websiteUrl: org.websiteUrl,
        allowDepartmentOverrides: org.allowDepartmentOverrides,
        lockedFields: org.lockedFields,
      },
    })
  }

  async function saveDepartment(departmentId: string) {
    const value = overrideFor(departmentId)
    const locked = lockedForActiveLevel.value
    const body: Record<string, unknown> = {
      allowTeamOverrides: value.allowTeamOverrides,
      lockedFields: value.lockedFields,
    }
    if (!locked.has('primaryColor')) body.primaryColor = value.primaryColor
    if (!locked.has('accentColor')) body.accentColor = value.accentColor
    if (!locked.has('logoAssetId')) body.logoAssetId = value.logoAssetId
    if (!locked.has('websiteUrl')) body.websiteUrl = value.websiteUrl
    if (!locked.has('displayFontAssetId')) body.displayFontAssetId = value.displayFontAssetId
    if (!locked.has('bodyFontAssetId')) body.bodyFontAssetId = value.bodyFontAssetId
    await api.request(`/v1/departments/${departmentId}/brand`, {
      method: 'PUT',
      body,
    })
  }

  async function save() {
    if (!organizationId.value) return
    saving.value = true
    errorMessage.value = ''
    try {
      if (activeLevel.value === 'organization') await saveOrganization()
      else if (activeLevel.value === 'department' && activeDepartmentId.value)
        await saveDepartment(activeDepartmentId.value)
      // Mannschaftsebene (PUT /v1/teams/:id/brand) folgt, sobald useActiveScope() 'team' liefert.
      await loadAll()
      refreshBrandRevision()
    } catch (error) {
      errorMessage.value =
        error instanceof ApiRequestError && error.code === 'invalid_logo' && error.data.message
          ? `Logo konnte nicht gespeichert werden: ${error.data.message}`
          : 'Die Marke konnte nicht gespeichert werden. Bitte erneut versuchen.'
    } finally {
      saving.value = false
    }
  }

  return { org, loading, loadError, saving, errorMessage, savedBrandWebsiteUrls, lockedForActiveLevel, loadAll, save }
}
