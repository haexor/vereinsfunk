import { isBrandAssetSelectable } from '@vereinsfunk/domain'
import type { ComputedRef, Ref } from 'vue'

export type BrandScopeLevel = 'organization' | 'department' | 'team'

export interface BrandAssetRow {
  id: string
  departmentId: string | null
  teamId: string | null
  kind: string
  objectPath: string
  status: string
  fontFamily: string | null
  fontWeight: number | null
  fontStyle: string | null
  licenseHolder: string | null
  createdAt: string
}

export interface BrandLevelOverride {
  primaryColor: string | null
  accentColor: string | null
  logoAssetId: string | null
  websiteUrl?: string | null
  displayFontAssetId: string | null
  bodyFontAssetId: string | null
  displayFontKey: string | null
  bodyFontKey: string | null
  allowTeamOverrides?: boolean
  lockedFields?: string[]
}

export interface BrandOrganizationState {
  primaryColor: string
  accentColor: string
  backgroundColor: string
  textColor: string
  onPrimaryColor: string
  displayFontKey: string
  bodyFontKey: string
  displayFontAssetId: string | null
  bodyFontAssetId: string | null
  logoAssetId: string | null
  websiteUrl: string | null
  allowDepartmentOverrides: boolean
  lockedFields: string[]
}

/**
 * Loads the tenant-scoped asset library. Consumers still decide which inherited assets are
 * selectable through useBrandAssets, so every UI uses the same scope rules.
 */
export async function fetchBrandAssets({
  supabase,
  organizationId,
}: {
  supabase: ReturnType<typeof useSupabaseClient>
  organizationId: string
}): Promise<BrandAssetRow[]> {
  const rows = await supabase
    .from('brand_assets')
    .select(
      'id, department_id, team_id, kind, object_path, status, font_family, font_weight, font_style, license_holder, created_at',
    )
    .eq('organization_id', organizationId)
  if (rows.error) throw rows.error
  return (rows.data ?? []).map((asset) => ({
    id: asset.id,
    departmentId: asset.department_id,
    teamId: asset.team_id,
    kind: asset.kind,
    objectPath: asset.object_path,
    status: asset.status,
    fontFamily: asset.font_family,
    fontWeight: asset.font_weight,
    fontStyle: asset.font_style,
    licenseHolder: asset.license_holder,
    createdAt: asset.created_at,
  }))
}

export function useBrandAssets({
  api,
  supabase,
  organizationId,
  org,
  activeLevel,
  activeDepartmentId,
  activeTeamId,
  activeDepartmentOverride,
  activeTeamOverride,
  reload,
}: {
  api: ReturnType<typeof useApiClient>
  supabase: ReturnType<typeof useSupabaseClient>
  organizationId: ComputedRef<string | null>
  org: BrandOrganizationState
  activeLevel: Readonly<Ref<BrandScopeLevel>>
  activeDepartmentId: Readonly<Ref<string | null>>
  activeTeamId: Readonly<Ref<string | null>>
  activeDepartmentOverride: ComputedRef<BrandLevelOverride | null>
  activeTeamOverride: ComputedRef<BrandLevelOverride | null>
  reload: () => Promise<void>
}) {
  const assets = ref<BrandAssetRow[]>([])
  const assetSignedUrls = ref<Record<string, string>>({})
  const inFlightSignatures = new Map<string, Promise<void>>()

  function assetOrigin(asset: BrandAssetRow): string {
    if (asset.teamId) return 'aus dieser Mannschaft'
    if (asset.departmentId) return 'aus dieser Abteilung'
    return 'vom Verein'
  }

  const selectableLogoAssets = computed(() =>
    assets.value.filter(
      (asset) =>
        asset.status === 'ready' &&
        asset.kind !== 'font' &&
        asset.kind !== 'frame' &&
        isBrandAssetSelectable(
          {
            scope: asset.teamId ? 'team' : asset.departmentId ? 'department' : 'organization',
            departmentId: asset.departmentId ?? undefined,
            teamId: asset.teamId ?? undefined,
          },
          activeLevel.value,
          activeDepartmentId.value ?? undefined,
          activeTeamId.value ?? undefined,
        ),
    ),
  )
  const selectableFrameAssets = computed(() =>
    assets.value.filter(
      (asset) =>
        asset.status === 'ready' &&
        asset.kind === 'frame' &&
        isBrandAssetSelectable(
          {
            scope: asset.teamId ? 'team' : asset.departmentId ? 'department' : 'organization',
            departmentId: asset.departmentId ?? undefined,
            teamId: asset.teamId ?? undefined,
          },
          activeLevel.value,
          activeDepartmentId.value ?? undefined,
          activeTeamId.value ?? undefined,
        ),
    ),
  )
  const selectableFontAssets = computed(() =>
    assets.value.filter(
      (asset) =>
        asset.status === 'ready' &&
        asset.kind === 'font' &&
        isBrandAssetSelectable(
          {
            scope: asset.teamId ? 'team' : asset.departmentId ? 'department' : 'organization',
            departmentId: asset.departmentId ?? undefined,
            teamId: asset.teamId ?? undefined,
          },
          activeLevel.value,
          activeDepartmentId.value ?? undefined,
          activeTeamId.value ?? undefined,
        ),
    ),
  )
  const ownFontAssets = computed(() =>
    assets.value.filter((asset) => {
      if (asset.kind !== 'font') return false
      if (activeLevel.value === 'organization')
        return asset.departmentId === null && asset.teamId === null
      if (activeLevel.value === 'department')
        return asset.departmentId === activeDepartmentId.value && asset.teamId === null
      return asset.teamId === activeTeamId.value
    }),
  )
  const pendingLicenseAssets = computed(() =>
    ownFontAssets.value.filter((asset) => asset.status === 'processing'),
  )
  const ownLogoAssets = computed(() =>
    assets.value.filter((asset) => {
      if (
        asset.kind === 'font' ||
        asset.kind === 'frame' ||
        asset.status === 'replaced' ||
        asset.status === 'deleted'
      )
        return false
      if (activeLevel.value === 'organization')
        return asset.departmentId === null && asset.teamId === null
      if (activeLevel.value === 'department')
        return asset.departmentId === activeDepartmentId.value && asset.teamId === null
      return asset.teamId === activeTeamId.value
    }),
  )

  async function signAsset(asset: BrandAssetRow) {
    if (assetSignedUrls.value[asset.id]) return
    const inFlight = inFlightSignatures.get(asset.id)
    if (inFlight) return inFlight
    const signing = supabase.storage
      .from('brand-assets')
      .createSignedUrl(asset.objectPath, 600)
      .then((signed) => {
        if (signed.data) assetSignedUrls.value[asset.id] = signed.data.signedUrl
      })
      .finally(() => inFlightSignatures.delete(asset.id))
    inFlightSignatures.set(asset.id, signing)
    return signing
  }
  async function signAssets(list = assets.value): Promise<void> {
    await Promise.all(
      list
        .filter((asset) => asset.kind !== 'font' && asset.status === 'ready')
        .map((asset) => signAsset(asset)),
    )
  }
  // Nur 'ready' signieren: die Storage-RLS prueft den Asset-Status nicht, und ein Soft-Delete
  // entfernt das Storage-Objekt nicht -- eine tote Signed-URL fuer 'deleted'/'processing'/
  // 'rejected'/'replaced' waere sonst weiterhin abrufbar. Veraltete Eintraege (Asset nicht mehr
  // in der Liste oder nicht mehr signierbar) fallen aus assetSignedUrls, statt eine alte URL zu
  // behalten.
  watch(
    assets,
    (list) => {
      const signableIds = new Set(
        list
          .filter((asset) => asset.kind !== 'font' && asset.status === 'ready')
          .map((asset) => asset.id),
      )
      for (const id of Object.keys(assetSignedUrls.value))
        if (!signableIds.has(id)) delete assetSignedUrls.value[id]
      void signAssets(list)
    },
    { immediate: true },
  )

  const deletingAsset = ref<string | null>(null)
  const deleteAssetError = ref('')
  async function deleteAsset(assetId: string) {
    deletingAsset.value = assetId
    deleteAssetError.value = ''
    try {
      await api.request(`/v1/brand/assets/${assetId}`, { method: 'DELETE' })
      await reload()
    } catch {
      deleteAssetError.value = 'Das Logo konnte nicht entfernt werden.'
    } finally {
      deletingAsset.value = null
    }
  }

  // Ebenen-Gegenstueck zu toggleFontAsset unten: jede Ebene waehlt ihr aktives Logo ueber
  // dieselbe logoAssetId, die "als Logo" oben setzt -- ein erneuter Klick auf das bereits aktive
  // Logo muss es wieder auf null setzen koennen (erben/kein Logo), sonst gibt es keinen Weg zurueck.
  // Verein schreibt direkt auf `org` (kein Override-Objekt -- es gibt keine Ebene darueber, von
  // der er erben koennte), Abteilung/Mannschaft ueber ihr jeweiliges Override.
  function activeLogoOverride(): BrandLevelOverride | null {
    if (activeLevel.value === 'department') return activeDepartmentOverride.value
    if (activeLevel.value === 'team') return activeTeamOverride.value
    return null
  }

  function activeLogoAssetId(): string | null {
    if (activeLevel.value === 'organization') return org.logoAssetId
    return activeLogoOverride()?.logoAssetId ?? null
  }

  function toggleLogoAsset(assetId: string) {
    if (activeLevel.value === 'organization') {
      org.logoAssetId = org.logoAssetId === assetId ? null : assetId
      return
    }
    const target = activeLogoOverride()
    if (target) target.logoAssetId = target.logoAssetId === assetId ? null : assetId
  }

  function assignFontAsset(role: 'display' | 'body', assetId: string | null) {
    const key = role === 'display' ? 'displayFontAssetId' : 'bodyFontAssetId'
    if (activeLevel.value === 'organization') {
      org[key] = assetId
      return
    }
    const target =
      activeLevel.value === 'department' ? activeDepartmentOverride.value : activeTeamOverride.value
    if (target) target[key] = assetId
  }

  function activeFontAssetId(role: 'display' | 'body'): string | null {
    const key = role === 'display' ? 'displayFontAssetId' : 'bodyFontAssetId'
    if (activeLevel.value === 'organization') return org[key]
    return (
      (activeLevel.value === 'department'
        ? activeDepartmentOverride.value
        : activeTeamOverride.value)?.[key] ?? null
    )
  }

  function toggleFontAsset(role: 'display' | 'body', assetId: string) {
    assignFontAsset(role, activeFontAssetId(role) === assetId ? null : assetId)
  }

  const uploadingAsset = ref(false)
  const uploadError = ref('')
  async function uploadAsset(event: Event, kind: string) {
    const file = (event.target as HTMLInputElement).files?.[0] ?? null
    ;(event.target as HTMLInputElement).value = ''
    if (!file || !organizationId.value) return
    uploadingAsset.value = true
    uploadError.value = ''
    try {
      const formData = new FormData()
      formData.append('organizationId', organizationId.value)
      if (activeDepartmentId.value) formData.append('departmentId', activeDepartmentId.value)
      if (activeLevel.value === 'team' && activeTeamId.value)
        formData.append('teamId', activeTeamId.value)
      formData.append('kind', kind)
      formData.append('file', file)
      await api.request('/v1/brand/assets', { method: 'POST', body: formData })
      await reload()
    } catch {
      uploadError.value =
        'Die Datei konnte nicht hochgeladen werden. Bitte Format und Größe prüfen.'
    } finally {
      uploadingAsset.value = false
    }
  }

  const licenseDrafts = ref<
    Record<string, { licenseHolder: string; licenseNote: string; confirmed: boolean }>
  >({})
  function licenseDraftFor(assetId: string) {
    if (!licenseDrafts.value[assetId])
      licenseDrafts.value[assetId] = { licenseHolder: '', licenseNote: '', confirmed: false }
    return licenseDrafts.value[assetId]!
  }
  const confirmingLicense = ref<string | null>(null)
  async function confirmLicense(assetId: string) {
    const draft = licenseDraftFor(assetId)
    if (!draft.confirmed || !draft.licenseHolder.trim()) return
    confirmingLicense.value = assetId
    try {
      await api.request(`/v1/brand/assets/${assetId}/confirm-license`, {
        method: 'POST',
        body: {
          licenseHolder: draft.licenseHolder,
          licenseNote: draft.licenseNote || undefined,
          confirmed: true,
        },
      })
      await reload()
    } catch {
      uploadError.value = 'Die Lizenz konnte nicht bestätigt werden.'
    } finally {
      confirmingLicense.value = null
    }
  }

  return {
    assets,
    assetSignedUrls,
    selectableLogoAssets,
    selectableFrameAssets,
    selectableFontAssets,
    ownFontAssets,
    pendingLicenseAssets,
    ownLogoAssets,
    uploadingAsset,
    uploadError,
    licenseDrafts,
    confirmingLicense,
    assetOrigin,
    signAssets,
    deletingAsset,
    deleteAssetError,
    deleteAsset,
    activeFontAssetId,
    toggleFontAsset,
    activeLogoAssetId,
    toggleLogoAsset,
    uploadAsset,
    licenseDraftFor,
    confirmLicense,
  }
}
