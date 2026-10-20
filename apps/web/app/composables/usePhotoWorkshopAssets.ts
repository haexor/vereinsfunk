import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import {
  fetchBrandAssets,
  type BrandLevelOverride,
  type BrandOrganizationState,
  type BrandScopeLevel,
  useBrandAssets,
} from './useBrandAssets'

export type BrandAssetCard = { id: string; name: string; signedUrl: string }

/**
 * Rahmen und Logos der Bildwerkstatt samt Auswahl. Ohne mitgegebene Listen laedt sie die im
 * Arbeitsbereich waehlbaren Marken-Assets selbst ueber useBrandAssets (mandantensicher signiert).
 */
export function usePhotoWorkshopAssets(props: {
  organizationId: MaybeRefOrGetter<string | null | undefined>
  departmentId: MaybeRefOrGetter<string | null | undefined>
  frameAssets?: MaybeRefOrGetter<BrandAssetCard[] | undefined>
  logoAssets?: MaybeRefOrGetter<BrandAssetCard[] | undefined>
}) {
  const supabase = useSupabaseClient()
  const api = useApiClient()
  const loadingAssets = ref(false)
  const assetError = ref('')
  const selectedFrameId = ref<string | null>(null)
  const selectedLogoId = ref<string | null>(null)
  let latestAssetLoadRun = 0
  const organizationId = computed(() => toValue(props.organizationId) || null)
  const hasProvidedAssetLibrary = computed(
    () => toValue(props.frameAssets) !== undefined || toValue(props.logoAssets) !== undefined,
  )
  const activeLevel = computed<BrandScopeLevel>(() =>
    toValue(props.departmentId) ? 'department' : 'organization',
  )
  const activeDepartmentId = computed(() => toValue(props.departmentId) ?? null)
  const activeTeamId = computed(() => null)
  const noBrandOverride = computed<BrandLevelOverride | null>(() => null)
  const workshopBrand = reactive<BrandOrganizationState>({
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
    allowDepartmentOverrides: false,
    lockedFields: [],
  })

  async function loadBrandAssets() {
    const loadRun = ++latestAssetLoadRun
    const requestedOrganizationId = organizationId.value
    const requestedDepartmentId = activeDepartmentId.value
    selectedFrameId.value = null
    selectedLogoId.value = null
    assets.value = []
    if (!requestedOrganizationId || import.meta.server) {
      loadingAssets.value = false
      return
    }
    loadingAssets.value = true
    assetError.value = ''
    try {
      const loadedAssets = await fetchBrandAssets({ supabase, organizationId: requestedOrganizationId })
      if (
        loadRun !== latestAssetLoadRun ||
        requestedOrganizationId !== organizationId.value ||
        requestedDepartmentId !== activeDepartmentId.value
      )
        return
      assets.value = loadedAssets
      await signAssets()
    } catch {
      if (loadRun === latestAssetLoadRun)
        assetError.value = 'Rahmen und Logos konnten nicht geladen werden.'
    } finally {
      if (loadRun === latestAssetLoadRun) loadingAssets.value = false
    }
  }
  const { assets, assetSignedUrls, selectableFrameAssets, selectableLogoAssets, signAssets } =
    useBrandAssets({
      api,
      supabase,
      organizationId,
      org: workshopBrand,
      activeLevel,
      activeDepartmentId,
      activeTeamId,
      activeDepartmentOverride: noBrandOverride,
      activeTeamOverride: noBrandOverride,
      reload: loadBrandAssets,
    })
  function selectableAssetsToCards(list: typeof selectableFrameAssets.value): BrandAssetCard[] {
    return list.flatMap((asset) => {
      const signedUrl = assetSignedUrls.value[asset.id]
      return signedUrl
        ? [{ id: asset.id, name: asset.objectPath.split('/').at(-1) || asset.kind, signedUrl }]
        : []
    })
  }
  // Die Bildstil-Seite hat die sichtbaren, signierten Brand Assets bereits geladen. Diese Liste
  // direkt weiterzugeben vermeidet einen zweiten asynchronen Abruf, durch den die Rahmenkacheln
  // beim Oeffnen der Werkstatt bislang leer bleiben konnten. Beim Foto-Anhang ohne diese Props
  // bleibt der mandantensichere Fallback ueber useBrandAssets bestehen.
  const frames = computed(() => toValue(props.frameAssets) ?? selectableAssetsToCards(selectableFrameAssets.value))
  const logos = computed(() => toValue(props.logoAssets) ?? selectableAssetsToCards(selectableLogoAssets.value))
  const selectedFrame = computed(
    () => frames.value.find((frame) => frame.id === selectedFrameId.value) ?? null,
  )
  const selectedLogo = computed(
    () => logos.value.find((logo) => logo.id === selectedLogoId.value) ?? null,
  )

  onMounted(() => {
    if (!hasProvidedAssetLibrary.value) void loadBrandAssets()
  })
  watch([() => props.organizationId, () => props.departmentId], () => {
    if (!hasProvidedAssetLibrary.value) void loadBrandAssets()
  })
  onBeforeUnmount(() => {
    latestAssetLoadRun += 1
  })

  return { frames, logos, selectedFrameId, selectedLogoId, selectedFrame, selectedLogo, loadingAssets, assetError }
}
