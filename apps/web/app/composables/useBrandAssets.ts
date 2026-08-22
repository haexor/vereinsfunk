import { isBrandAssetSelectable } from '@vereinsfunk/domain'
import { BrandLogoUploadResponseSchema } from '@vereinsfunk/contracts'
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
  allowDepartmentOverrides: boolean
  lockedFields: string[]
  logoPath: string | null
  logoDarkPath: string | null
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
  activeLevel: Ref<BrandScopeLevel>
  activeDepartmentId: Ref<string | null>
  activeTeamId: Ref<string | null>
  activeDepartmentOverride: ComputedRef<BrandLevelOverride | null>
  activeTeamOverride: ComputedRef<BrandLevelOverride | null>
  reload: () => Promise<void>
}) {
  const assets = ref<BrandAssetRow[]>([])
  const assetSignedUrls = ref<Record<string, string>>({})
  const logoUrl = ref('')
  const logoDarkUrl = ref('')
  // Getrennte Refs pro Variante: ein gemeinsames Feld hier hiess vorher, dass die Auswahl des
  // hellen Logos verworfen wurde, sobald danach das dunkle Logo gewaehlt wurde (und umgekehrt).
  const logoFileLight = ref<File | null>(null)
  const logoFileDark = ref<File | null>(null)
  const logoPreviewUrlLight = ref('')
  const logoPreviewUrlDark = ref('')

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
          { scope: asset.teamId ? 'team' : asset.departmentId ? 'department' : 'organization', departmentId: asset.departmentId ?? undefined, teamId: asset.teamId ?? undefined },
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
          { scope: asset.teamId ? 'team' : asset.departmentId ? 'department' : 'organization', departmentId: asset.departmentId ?? undefined, teamId: asset.teamId ?? undefined },
          activeLevel.value,
          activeDepartmentId.value ?? undefined,
          activeTeamId.value ?? undefined,
        ),
    ),
  )
  const ownFontAssets = computed(() =>
    assets.value.filter((asset) => {
      if (asset.kind !== 'font') return false
      if (activeLevel.value === 'organization') return asset.departmentId === null && asset.teamId === null
      if (activeLevel.value === 'department') return asset.departmentId === activeDepartmentId.value && asset.teamId === null
      return asset.teamId === activeTeamId.value
    }),
  )
  const pendingLicenseAssets = computed(() => ownFontAssets.value.filter((asset) => asset.status === 'processing'))
  const ownLogoAssets = computed(() =>
    assets.value.filter((asset) => {
      if (asset.kind === 'font' || asset.kind === 'logo_primary' || asset.kind === 'logo_dark' || asset.kind === 'frame' || asset.status === 'replaced') return false
      if (activeLevel.value === 'organization') return asset.departmentId === null && asset.teamId === null
      if (activeLevel.value === 'department') return asset.departmentId === activeDepartmentId.value && asset.teamId === null
      return asset.teamId === activeTeamId.value
    }),
  )

  async function signAsset(asset: BrandAssetRow) {
    if (assetSignedUrls.value[asset.id]) return
    const signed = await supabase.storage.from('brand-assets').createSignedUrl(asset.objectPath, 600)
    if (signed.data) assetSignedUrls.value[asset.id] = signed.data.signedUrl
  }
  watch(assets, (list) => { for (const asset of list) if (asset.kind !== 'font' && asset.status !== 'replaced') void signAsset(asset) }, { immediate: true })

  // Aus onLogoSelected herausgezogen (Paket 048), damit ein KI-vorgeschlagenes Logo denselben
  // Vorschau-/Speicherpfad wie ein manueller Upload durchlaeuft, statt einen zweiten zu bauen.
  function applyLogoFile(file: File, variant: 'light' | 'dark') {
    const fileRef = variant === 'light' ? logoFileLight : logoFileDark
    const previewRef = variant === 'light' ? logoPreviewUrlLight : logoPreviewUrlDark
    if (previewRef.value) URL.revokeObjectURL(previewRef.value)
    fileRef.value = file
    previewRef.value = URL.createObjectURL(file)
  }

  // Verwirft ein vorgemerktes, noch nicht gespeichertes Logo. Ohne diesen Weg liess sich ein
  // KI-vorgeschlagenes Logo (Paket 048) nicht mehr ablehnen: jedes spaetere Speichern haette es
  // hochgeladen und das bisherige Asset auf 'replaced' gesetzt.
  function clearLogoFile(variant: 'light' | 'dark') {
    const fileRef = variant === 'light' ? logoFileLight : logoFileDark
    const previewRef = variant === 'light' ? logoPreviewUrlLight : logoPreviewUrlDark
    if (previewRef.value) URL.revokeObjectURL(previewRef.value)
    fileRef.value = null
    previewRef.value = ''
  }

  function onLogoSelected(event: Event, variant: 'light' | 'dark') {
    const file = (event.target as HTMLInputElement).files?.[0]
    if (file) applyLogoFile(file, variant)
  }

  const sanitizedNotice = ref(false)
  async function saveOrgLogoIfSelected() {
    if (!organizationId.value) return
    const pending = (['light', 'dark'] as const)
      .map((variant) => ({ variant, file: variant === 'light' ? logoFileLight.value : logoFileDark.value }))
      .filter((entry): entry is { variant: 'light' | 'dark', file: File } => entry.file !== null)
    for (const { variant, file } of pending) {
      const formData = new FormData()
      formData.append('variant', variant)
      formData.append('file', file)
      const uploaded = await api.request(
        `/v1/organizations/${organizationId.value}/brand/logo`,
        { method: 'POST', body: formData },
        BrandLogoUploadResponseSchema,
      )
      const fileRef = variant === 'light' ? logoFileLight : logoFileDark
      const previewRef = variant === 'light' ? logoPreviewUrlLight : logoPreviewUrlDark
      if (variant === 'light') logoUrl.value = uploaded.signedUrl
      else logoDarkUrl.value = uploaded.signedUrl
      if (uploaded.sanitized) sanitizedNotice.value = true
      fileRef.value = null
      URL.revokeObjectURL(previewRef.value)
      previewRef.value = ''
    }
  }

  const removingLogo = ref<'light' | 'dark' | null>(null)
  const logoRemoveError = ref('')
  async function removeOrgLogo(variant: 'light' | 'dark') {
    if (!organizationId.value) return
    removingLogo.value = variant
    logoRemoveError.value = ''
    try {
      await api.request(`/v1/organizations/${organizationId.value}/brand/logo`, { method: 'DELETE', query: { variant } })
      if (variant === 'light') logoUrl.value = ''
      else logoDarkUrl.value = ''
    } catch {
      logoRemoveError.value = 'Das Logo konnte nicht entfernt werden.'
    } finally {
      removingLogo.value = null
    }
  }

  // Ebenen-Gegenstueck zu toggleFontAsset unten: eine Abteilung/Mannschaft waehlt ihr Logo ueber
  // dieselbe logoAssetId, die "als Logo" oben setzt -- ein erneuter Klick auf das bereits aktive
  // Logo muss es wieder auf null setzen koennen (erben), sonst gibt es fuer diese Ebene keinen Weg
  // zurueck zum geerbten Logo.
  function activeLogoOverride(): BrandLevelOverride | null {
    if (activeLevel.value === 'department') return activeDepartmentOverride.value
    if (activeLevel.value === 'team') return activeTeamOverride.value
    return null
  }

  function activeLogoAssetId(): string | null {
    return activeLogoOverride()?.logoAssetId ?? null
  }

  function toggleLogoAsset(assetId: string) {
    const target = activeLogoOverride()
    if (target) target.logoAssetId = target.logoAssetId === assetId ? null : assetId
  }

  function assignFontAsset(role: 'display' | 'body', assetId: string | null) {
    const key = role === 'display' ? 'displayFontAssetId' : 'bodyFontAssetId'
    if (activeLevel.value === 'organization') { org[key] = assetId; return }
    const target = activeLevel.value === 'department' ? activeDepartmentOverride.value : activeTeamOverride.value
    if (target) target[key] = assetId
  }

  function activeFontAssetId(role: 'display' | 'body'): string | null {
    const key = role === 'display' ? 'displayFontAssetId' : 'bodyFontAssetId'
    if (activeLevel.value === 'organization') return org[key]
    return (activeLevel.value === 'department' ? activeDepartmentOverride.value : activeTeamOverride.value)?.[key] ?? null
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
      if (activeLevel.value === 'team' && activeTeamId.value) formData.append('teamId', activeTeamId.value)
      formData.append('kind', kind)
      formData.append('file', file)
      await api.request('/v1/brand/assets', { method: 'POST', body: formData })
      await reload()
    } catch {
      uploadError.value = 'Die Datei konnte nicht hochgeladen werden. Bitte Format und Größe prüfen.'
    } finally {
      uploadingAsset.value = false
    }
  }

  const licenseDrafts = ref<Record<string, { licenseHolder: string, licenseNote: string, confirmed: boolean }>>({})
  function licenseDraftFor(assetId: string) {
    if (!licenseDrafts.value[assetId]) licenseDrafts.value[assetId] = { licenseHolder: '', licenseNote: '', confirmed: false }
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
        body: { licenseHolder: draft.licenseHolder, licenseNote: draft.licenseNote || undefined, confirmed: true },
      })
      await reload()
    } catch {
      uploadError.value = 'Die Lizenz konnte nicht bestätigt werden.'
    } finally {
      confirmingLicense.value = null
    }
  }

  onBeforeUnmount(() => {
    if (logoPreviewUrlLight.value) URL.revokeObjectURL(logoPreviewUrlLight.value)
    if (logoPreviewUrlDark.value) URL.revokeObjectURL(logoPreviewUrlDark.value)
  })

  return {
    assets, assetSignedUrls, logoUrl, logoDarkUrl, logoPreviewUrlLight, logoPreviewUrlDark,
    sanitizedNotice, selectableLogoAssets, selectableFontAssets, ownFontAssets,
    pendingLicenseAssets, ownLogoAssets, uploadingAsset, uploadError, licenseDrafts,
    confirmingLicense, assetOrigin, onLogoSelected, applyLogoFile, clearLogoFile,
    logoFileLight, logoFileDark, saveOrgLogoIfSelected, removingLogo, logoRemoveError, removeOrgLogo,
    activeFontAssetId, toggleFontAsset, activeLogoAssetId, toggleLogoAsset,
    uploadAsset, licenseDraftFor, confirmLicense,
  }
}
