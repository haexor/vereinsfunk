import { findCuratedFont, isBrandAssetSelectable } from '@vereinsfunk/domain'
import { BrandLogoUploadResponseSchema } from '@vereinsfunk/contracts'
import type { ComputedRef, Ref } from 'vue'

export type BrandTone = 'nahbar' | 'dynamisch' | 'sachlich'
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
  tone: BrandTone | null
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
  tone: BrandTone
  displayFontKey: string
  bodyFontKey: string
  displayFontAssetId: string | null
  bodyFontAssetId: string | null
  allowDepartmentOverrides: boolean
  lockedFields: string[]
  logoPath: string | null
  logoDarkPath: string | null
}

interface ResolvedBrand {
  displayFontAssetId: string | null
  displayFontKey: string | null
  bodyFontAssetId: string | null
  bodyFontKey: string | null
  logoAssetId: string | null
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
  resolved,
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
  resolved: ComputedRef<ResolvedBrand>
  reload: () => Promise<void>
}) {
  const assets = ref<BrandAssetRow[]>([])
  const assetSignedUrls = ref<Record<string, string>>({})
  const logoUrl = ref('')
  const logoDarkUrl = ref('')
  const logoFile = ref<File | null>(null)
  const logoPreviewUrl = ref('')
  const logoVariant = ref<'light' | 'dark'>('light')

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
      if (asset.kind === 'font' || asset.kind === 'logo_primary' || asset.kind === 'logo_dark' || asset.status === 'replaced') return false
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

  const previewFontFaceCss = ref('')
  const previewDisplayFamily = ref('Manrope')
  const previewBodyFamily = ref('DM Sans')
  const PREVIEW_DISPLAY_FAMILY = 'vf-preview-display'
  const PREVIEW_BODY_FAMILY = 'vf-preview-body'

  function cssUrlLiteral(url: string): string {
    return `'${url.replace(/[\\'"<>]/g, (character) => `\\${character.charCodeAt(0).toString(16)} `)}'`
  }

  async function fontFamilyForPreview(assetId: string | null, fontKey: string | null, cssFamilyName: string): Promise<{ family: string, faceRule: string | null }> {
    if (assetId) {
      const asset = assets.value.find((row) => row.id === assetId && row.kind === 'font' && row.status === 'ready')
      if (asset) {
        const signed = await supabase.storage.from('brand-assets').createSignedUrl(asset.objectPath, 600)
        if (signed.data) return { family: cssFamilyName, faceRule: `@font-face { font-family: '${cssFamilyName}'; src: url(${cssUrlLiteral(signed.data.signedUrl)}) format('woff2'); font-weight: ${asset.fontWeight ?? 400}; font-style: ${asset.fontStyle ?? 'normal'}; }` }
      }
    }
    const curated = findCuratedFont(fontKey ?? 'manrope')
    return { family: curated?.family ?? 'Manrope', faceRule: null }
  }

  watchEffect(async (onCleanup) => {
    let cancelled = false
    onCleanup(() => { cancelled = true })
    const display = await fontFamilyForPreview(resolved.value.displayFontAssetId, resolved.value.displayFontKey, PREVIEW_DISPLAY_FAMILY)
    const body = await fontFamilyForPreview(resolved.value.bodyFontAssetId, resolved.value.bodyFontKey, PREVIEW_BODY_FAMILY)
    if (cancelled) return
    previewDisplayFamily.value = display.family
    previewBodyFamily.value = body.family
    previewFontFaceCss.value = [display.faceRule, body.faceRule].filter(Boolean).join('\n')
  })
  useHead(() => ({ style: previewFontFaceCss.value ? [{ innerHTML: previewFontFaceCss.value }] : [] }))

  const previewLogoUrl = computed(() => {
    const assetId = resolved.value.logoAssetId
    if (!assetId) return activeLevel.value === 'organization' ? logoUrl.value : ''
    return assetSignedUrls.value[assetId] ?? ''
  })

  function onLogoSelected(event: Event, variant: 'light' | 'dark') {
    const file = (event.target as HTMLInputElement).files?.[0] ?? null
    if (logoPreviewUrl.value) URL.revokeObjectURL(logoPreviewUrl.value)
    logoFile.value = file
    logoVariant.value = variant
    logoPreviewUrl.value = file ? URL.createObjectURL(file) : ''
  }

  const sanitizedNotice = ref(false)
  async function saveOrgLogoIfSelected() {
    if (!logoFile.value || !organizationId.value) return
    const formData = new FormData()
    formData.append('variant', logoVariant.value)
    formData.append('file', logoFile.value)
    const uploaded = await api.request(
      `/v1/organizations/${organizationId.value}/brand/logo`,
      { method: 'POST', body: formData },
      BrandLogoUploadResponseSchema,
    )
    if (logoVariant.value === 'light') logoUrl.value = uploaded.signedUrl
    else logoDarkUrl.value = uploaded.signedUrl
    sanitizedNotice.value = uploaded.sanitized
    logoFile.value = null
    URL.revokeObjectURL(logoPreviewUrl.value)
    logoPreviewUrl.value = ''
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
    if (logoPreviewUrl.value) URL.revokeObjectURL(logoPreviewUrl.value)
  })

  return {
    assets, assetSignedUrls, logoUrl, logoDarkUrl, logoPreviewUrl, logoVariant,
    sanitizedNotice, selectableLogoAssets, selectableFontAssets, ownFontAssets,
    pendingLicenseAssets, ownLogoAssets, previewDisplayFamily, previewBodyFamily,
    previewFontFaceCss, previewLogoUrl, uploadingAsset, uploadError, licenseDrafts,
    confirmingLicense, assetOrigin, onLogoSelected, saveOrgLogoIfSelected,
    activeFontAssetId, toggleFontAsset, uploadAsset, licenseDraftFor, confirmLicense,
  }
}
