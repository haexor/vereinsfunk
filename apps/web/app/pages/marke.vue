<script setup lang="ts">
import { curatedFontPairings, resolveBrand, type CuratedFontPairing } from '@vereinsfunk/domain'
import { BrandAssetSchema, type BrandWebsiteAnalysisResult } from '@vereinsfunk/contracts'
import type { DepartmentColorPatch, OrganizationColorPatch } from '../components/BrandColorRoles.vue'
import { useBrandAssets } from '../composables/useBrandAssets'
import { useBrandOverrides } from '../composables/useBrandOverrides'
import { useBrandPageData } from '../composables/useBrandPageData'
import { useBrandWebsiteAnalysis } from '../composables/useBrandWebsiteAnalysis'
import { brandAnalysisFailureMessage } from '../utils/brandAnalysisFailure'

const api = useApiClient()
const { organizationId, departmentId: activeDepartmentId, teamId: activeTeamId, level: activeLevel } = await useActiveScope()
const supabase = useSupabaseClient()

const overrides = useBrandOverrides()
const { readOverride, readTeamOverride, overrideFor } = overrides
const {
  org,
  loading,
  loadError,
  saving,
  errorMessage,
  savedBrandWebsiteUrls,
  lockedForActiveLevel,
  loadAll,
  save,
} = useBrandPageData({
  api,
  supabase,
  organizationId,
  activeLevel,
  activeDepartmentId,
  overrides,
  onAssetsLoaded: (loaded) => { assets.value = loaded },
})

const activeDepartmentOverride = computed(() =>
  activeDepartmentId.value ? readOverride(activeDepartmentId.value) : null,
)
const activeTeamOverride = computed(() =>
  activeTeamId.value ? readTeamOverride(activeTeamId.value) : null,
)
const activeBrandWebsiteKey = computed(() => {
  if (!organizationId.value) return null
  return activeLevel.value === 'department' && activeDepartmentId.value
    ? `department:${activeDepartmentId.value}`
    : activeLevel.value === 'organization'
      ? `organization:${organizationId.value}`
      : null
})

const resolved = computed(() => {
  const departmentLevel = activeDepartmentId.value ? readOverride(activeDepartmentId.value) : null
  return resolveBrand(
    { ...org },
    activeLevel.value === 'organization'
      ? null
      : departmentLevel
        ? {
            ...departmentLevel,
            allowTeamOverrides: departmentLevel.allowTeamOverrides ?? true,
            lockedFields: departmentLevel.lockedFields ?? [],
          }
        : null,
    null,
  )
})

const {
  assets,
  assetSignedUrls,
  selectableLogoAssets,
  selectableFontAssets,
  pendingLicenseAssets,
  ownLogoAssets,
  uploadingAsset,
  uploadError,
  confirmingLicense,
  assetOrigin,
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
} = useBrandAssets({
  api,
  supabase,
  organizationId,
  org,
  activeLevel,
  activeDepartmentId,
  activeTeamId,
  activeDepartmentOverride,
  activeTeamOverride,
  reload: loadAll,
})

async function removeLogo(assetId: string) {
  if (!confirm('Logo wirklich entfernen?')) return
  await deleteAsset(assetId)
}

function updateOrganization(patch: OrganizationColorPatch) {
  Object.assign(org, patch)
}
function updateDepartment(patch: DepartmentColorPatch) {
  if (activeDepartmentId.value) Object.assign(overrideFor(activeDepartmentId.value), patch)
}
function selectFontPairing(pairing: CuratedFontPairing) {
  org.displayFontKey = pairing.displayFontKey
  org.bodyFontKey = pairing.bodyFontKey
}

// Die Homepage ist eine eigene, dauerhafte Markeneinstellung. Die Analyse erhält keine URL aus
// dem Browser, sondern startet danach ausschliesslich mit der serverseitig gespeicherten Adresse.
const brandWebsiteUrl = computed({
  get: () =>
    activeLevel.value === 'organization'
      ? (org.websiteUrl ?? '')
      : activeLevel.value === 'department'
        ? (activeDepartmentOverride.value?.websiteUrl ?? '')
        : '',
  set: (value) => {
    if (activeLevel.value === 'organization') org.websiteUrl = value || null
    else if (
      activeLevel.value === 'department' &&
      activeDepartmentId.value &&
      !lockedForActiveLevel.value.has('websiteUrl')
    )
      overrideFor(activeDepartmentId.value).websiteUrl = value || null
  },
})
const brandWebsiteUrlNeedsSaving = computed(() => {
  const key = activeBrandWebsiteKey.value
  if (!key) return false
  return brandWebsiteUrl.value.trim() !== (savedBrandWebsiteUrls.value[key] ?? '')
})
const websiteAnalysisScope = computed(() => {
  if (!organizationId.value) return null
  if (activeLevel.value === 'department' && activeDepartmentId.value)
    return { organizationId: organizationId.value, departmentId: activeDepartmentId.value }
  if (activeLevel.value === 'organization')
    return { organizationId: organizationId.value, departmentId: null }
  return null
})
const {
  status: websiteAnalysisStatus,
  result: websiteAnalysisResult,
  errorReason: websiteAnalysisErrorReason,
  startError: websiteAnalysisStartError,
  starting: websiteAnalysisStarting,
  startAnalysis: requestWebsiteAnalysis,
  scopeKey: websiteAnalysisScopeKey,
} = useBrandWebsiteAnalysis({ api, scope: websiteAnalysisScope })
const websiteAnalysisRunning = computed(
  () => websiteAnalysisStatus.value === 'pending' || websiteAnalysisStatus.value === 'running',
)
const detectedFontNotice = computed(() => {
  const detected = websiteAnalysisResult.value?.detectedFontFamily
  return detected
    ? `Auf der Webseite erkannt: „${detected}“ — kann aus Datenschutzgründen nicht automatisch übernommen werden; bei Bedarf oben als eigene Schriftdatei mit Lizenzbestätigung hochladen.`
    : ''
})
const websiteAnalysisFailureMessage = computed(() =>
  websiteAnalysisStatus.value === 'failed'
    ? brandAnalysisFailureMessage(websiteAnalysisErrorReason.value)
    : '',
)

// Genau die Formate, die der Logo-Upload akzeptiert, und das multipart-Limit der API
// (apps/api/src/app.ts, fileSize 8 MiB): ein Vorschlag, den der Speicherpfad ohnehin ablehnen
// wuerde, wird gar nicht erst vorgemerkt.
const ANALYSIS_LOGO_MIME_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml']
const ANALYSIS_LOGO_MAX_BYTES = 8 * 1024 * 1024

async function downloadLogoCandidate(logoCandidate: {
  signedUrl: string
  mimeType: string
}): Promise<File | null> {
  try {
    const downloaded = await fetch(logoCandidate.signedUrl)
    // fetch lehnt bei 4xx/5xx nicht ab. Ohne diese Pruefung wuerde der Fehlerbody als Logo
    // vorgemerkt -- und weil save() das Logo vor der Marke speichert, scheiterte danach das
    // gesamte Speichern, Farben und Schriften eingeschlossen.
    if (!downloaded.ok) return null
    const blob = await downloaded.blob()
    const mimeType = blob.type.split(';')[0]!.trim().toLowerCase()
    if (!ANALYSIS_LOGO_MIME_TYPES.includes(mimeType)) return null
    if (blob.size === 0 || blob.size > ANALYSIS_LOGO_MAX_BYTES) return null
    const extension = mimeType.split('/')[1]!.split('+')[0]
    return new File([blob], `homepage-logo.${extension}`, { type: mimeType })
  } catch {
    return null
  }
}

// Weder Verein noch Abteilung haben einen Datei-Staging-Mechanismus -- ein uebernommener
// KI-Logovorschlag laeuft wie ein manueller Upload sofort ueber die geteilte Asset-Bibliothek
// (POST /v1/brand/assets) und erscheint danach in der Galerie unten. Anders als frueher setzt das
// KEIN aktives Logo (logoAssetId) -- bei mehreren gefundenen Vorschlaegen ist das eine bewusste
// menschliche Entscheidung ueber den bestehenden "als Logo"-Umschalter, keine Auto-Klassifizierung.
async function uploadLogoSuggestion(
  departmentId: string | null,
  logoCandidate: { signedUrl: string; mimeType: string },
): Promise<boolean> {
  const file = await downloadLogoCandidate(logoCandidate)
  if (!file || !organizationId.value) return false
  const formData = new FormData()
  formData.append('organizationId', organizationId.value)
  if (departmentId) formData.append('departmentId', departmentId)
  formData.append('kind', 'logo_primary')
  formData.append('file', file)
  try {
    const uploaded = await api.request(
      '/v1/brand/assets',
      { method: 'POST', body: formData },
      BrandAssetSchema,
    )
    // loadAll() wuerde hier ungespeicherte Farb-Uebernahmen aus derselben Funktion sofort wieder
    // verwerfen (es ersetzt departmentOverrides komplett durch den DB-Stand) -- die neue Asset-
    // Zeile wird deshalb lokal angehaengt statt per vollem Reload nachgeladen. Der Upload ist
    // inhalts-adressiert (gleicher Dateiinhalt -> gleicher object_path -> derselbe upsert-Treffer);
    // zweimaliges Uebernehmen desselben Vorschlags lieferte sonst dieselbe id ein zweites Mal und
    // verletzte die :key-Eindeutigkeit in der Asset-Liste unten.
    if (!assets.value.some((asset) => asset.id === uploaded.id)) {
      assets.value = [
        ...assets.value,
        {
          id: uploaded.id,
          departmentId: uploaded.departmentId,
          teamId: uploaded.teamId,
          kind: uploaded.kind,
          objectPath: uploaded.objectPath,
          status: uploaded.status,
          fontFamily: uploaded.fontFamily,
          fontWeight: uploaded.fontWeight,
          fontStyle: uploaded.fontStyle,
          licenseHolder: uploaded.licenseHolder,
          createdAt: uploaded.createdAt,
        },
      ]
    }
    return true
  } catch {
    return false
  }
}

// Ein Klick pro gefundenem Logo-Kandidaten; der Übernommen-Status wird bei einem neuen
// Analyseergebnis zurückgesetzt.
const logoSuggestionApplied = ref<boolean[]>([])
watch(
  () => websiteAnalysisResult.value?.logoCandidates,
  (candidates) => {
    logoSuggestionApplied.value = (candidates ?? []).map(() => false)
  },
)
async function applyLogoSuggestion(index: number) {
  const candidate = websiteAnalysisResult.value?.logoCandidates[index]
  if (!candidate) return
  const departmentId = activeLevel.value === 'department' ? activeDepartmentId.value : null
  if (await uploadLogoSuggestion(departmentId, candidate)) logoSuggestionApplied.value[index] = true
}

async function applyWebsiteAnalysisResult(result: BrandWebsiteAnalysisResult) {
  if (activeLevel.value === 'department' && activeDepartmentId.value) {
    // Nur Primaer-/Akzentfarbe: Hintergrund-/Text-/Auf-Primaer-Farbe und das kuratierte
    // Schriftpaar bleiben bewusst Vereinssache (packages/domain/src/brand.ts) -- eine Abteilung
    // kann sie technisch gar nicht setzen, unabhaengig von dieser Funktion. Logos werden nicht mehr
    // automatisch uebernommen (siehe applyLogoSuggestion), unabhaengig vom Scope.
    // Vom Verein gesperrte Felder respektieren, genau wie die manuellen Farbfelder oben
    // (:disabled="lockedForActiveLevel.has(...)") -- sonst schriebe ein automatisch uebernommener
    // Vorschlag einen Wert in ein gesperrtes Feld, den "Aenderungen speichern" anschliessend mit
    // 400 field_locked fuer die GESAMTE Abteilung ablehnt, ohne dass die UI den Grund zeigt.
    const locked = lockedForActiveLevel.value
    const override = overrideFor(activeDepartmentId.value)
    if (!locked.has('primaryColor')) override.primaryColor = result.primaryColor
    if (!locked.has('accentColor')) override.accentColor = result.accentColor
    return
  }
  org.primaryColor = result.primaryColor
  org.accentColor = result.accentColor
  const pairing = curatedFontPairings.find((entry) => entry.key === result.suggestedFontPairingKey)
  if (pairing) {
    org.displayFontKey = pairing.displayFontKey
    org.bodyFontKey = pairing.bodyFontKey
    // Eine eigene Schriftdatei soll Vorrang vor dem kuratierten Font-Key haben (siehe die
    // FontSpec-Praezedenz in apps/remotion/src/ClubPost.tsx). Bliebe displayFontAssetId/
    // bodyFontAssetId hier gesetzt, waere der gerade uebernommene Vorschlag fuer jeden
    // kuenftigen Verbraucher dieser Praezedenz wirkungslos, obwohl er als aktueller Stand
    // gespeichert wird.
    org.displayFontAssetId = null
    org.bodyFontAssetId = null
  }
}
// Uebernommen wird nur auf der Ebene, fuer die der Job tatsaechlich lief (Verein oder die eine
// Abteilung, die ihn gestartet hat): das Polling laeuft weiter, auch wenn der Nutzer inzwischen
// die Ebene gewechselt hat. Dort waere die Uebernahme unsichtbar (der Block zeigt einen anderen
// Scope), veraenderte aber die falschen Formularfelder.
const websiteAnalysisApplied = ref(false)
// Jeder Scope-Wechsel (nicht nur das Betreten einer Abteilung) setzt das Flag zurueck -- sonst
// zeigte ein Wechsel zurueck zum Verein weiter "Vorschlag uebernommen" von der zuletzt
// betrachteten Abteilung, obwohl der Verein selbst nichts uebernommen hat. scopeKey kommt aus dem
// Composable selbst (nicht hier neu gebaut) -- sonst muessten zwei identisch formatierte Kopien
// synchron gehalten werden.
watch(websiteAnalysisScopeKey, () => {
  websiteAnalysisApplied.value = false
})
watch([websiteAnalysisStatus, websiteAnalysisScope], () => {
  if (websiteAnalysisApplied.value) return
  if (websiteAnalysisStatus.value !== 'succeeded' || !websiteAnalysisScope.value) return
  const suggestion = websiteAnalysisResult.value
  if (!suggestion) return
  websiteAnalysisApplied.value = true
  void applyWebsiteAnalysisResult(suggestion)
})

async function startWebsiteAnalysis() {
  websiteAnalysisApplied.value = false
  await requestWebsiteAnalysis()
}

await loadAll()

watch(organizationId, () => { void loadAll() })
watch(activeDepartmentId, (departmentId) => {
  if (departmentId) overrideFor(departmentId)
  errorMessage.value = ''
}, { immediate: true })

usePageSaveFab({ label: 'Änderungen speichern', save, saving })
</script>

<template>
  <div>
    <header class="mb-8">
      <div class="eyebrow mb-3">Vereinsprofil</div>
      <h1 class="font-display text-3xl font-extrabold tracking-[-.04em]">Marke</h1>
      <p class="mt-2 text-sm text-[#727a75]">
        So erkennt man euren Verein, seine Abteilungen und Mannschaften in jedem Beitrag wieder.
      </p>
    </header>

    <div v-if="loading" class="p-8 text-center text-xs text-[#7b827d]">Wird geladen …</div>
    <div v-else-if="loadError" class="card p-8 text-center text-sm font-semibold text-red-700">
      Die Markendaten konnten nicht geladen werden. Bitte lade die Seite neu.
    </div>
    <template v-else>
      <div class="space-y-6">
        <section
          v-if="activeLevel === 'organization' || (activeLevel === 'department' && org.allowDepartmentOverrides)"
          class="card p-6"
        >
          <h2 class="font-display text-base font-bold">Homepage</h2>
          <p class="mt-2 text-xs text-[#7a817c]">
            Diese Adresse wird dauerhaft für {{ activeLevel === 'department' ? 'die Abteilung' : 'den Verein' }} gespeichert.
            Nach dem Speichern nutzt die Analyse genau diese Homepage.
          </p>
          <input
            v-model="brandWebsiteUrl"
            type="url"
            :placeholder="activeLevel === 'department' ? 'https://abteilung.euer-verein.de' : 'https://euer-verein.de'"
            class="focus-ring mt-4 w-full rounded-lg border border-[#dfe0d9] px-3 py-2 text-xs"
            :disabled="activeLevel === 'department' && lockedForActiveLevel.has('websiteUrl')"
          />
          <p class="mt-2 text-[11px] text-[#7a817c]">Mit „Änderungen speichern“ wird die Adresse übernommen.</p>
        </section>

        <!-- KI-Markenerkennung aus der gespeicherten Homepage (Verein oder Abteilung, füllt nur vor) -->
        <!-- Ohne allowDepartmentOverrides kann eine Abteilung ohnehin kein eigenes Branding
               speichern (PUT .../brand lehnt mit 400 overrides_not_allowed ab) -- die Karte bliebe
               sonst sichtbar und würde einen echten, kostenpflichtigen Analyse-Lauf anstoßen, dessen
               Ergebnis garantiert nicht gespeichert werden kann. -->
        <BrandWebsiteAnalysisCard
          v-if="activeLevel === 'organization' || (activeLevel === 'department' && org.allowDepartmentOverrides)"
          :is-department="activeLevel === 'department'"
          :running="websiteAnalysisRunning"
          :starting="websiteAnalysisStarting"
          :start-disabled="
            websiteAnalysisRunning ||
            websiteAnalysisStarting ||
            !brandWebsiteUrl.trim() ||
            brandWebsiteUrlNeedsSaving ||
            (activeLevel === 'department' && lockedForActiveLevel.has('websiteUrl'))
          "
          :needs-saving="brandWebsiteUrlNeedsSaving"
          :start-error="websiteAnalysisStartError"
          :failure-message="websiteAnalysisFailureMessage"
          :applied="websiteAnalysisApplied"
          :detected-font-notice="detectedFontNotice"
          :logo-candidates="websiteAnalysisResult?.logoCandidates ?? []"
          :logo-applied="logoSuggestionApplied"
          @start="startWebsiteAnalysis"
          @apply-logo="applyLogoSuggestion"
        />

        <BrandLogoSection
          :level="activeLevel"
          :own-logo-assets="ownLogoAssets"
          :selectable-logo-assets="selectableLogoAssets"
          :asset-signed-urls="assetSignedUrls"
          :active-logo-asset-id="activeLogoAssetId()"
          :logo-locked="lockedForActiveLevel.has('logoAssetId')"
          :uploading="uploadingAsset"
          :deleting-asset-id="deletingAsset"
          :delete-error="deleteAssetError"
          :asset-origin="assetOrigin"
          @upload="uploadAsset($event, 'logo_primary')"
          @toggle="toggleLogoAsset"
          @remove="removeLogo"
        />

        <BrandColorRoles
          :level="activeLevel"
          :organization="org"
          :department-override="activeDepartmentOverride"
          :locked="lockedForActiveLevel"
          :resolved="resolved"
          @update-organization="updateOrganization"
          @update-department="updateDepartment"
        />

        <BrandFontSection
          :level="activeLevel"
          :display-font-key="org.displayFontKey"
          :uploading="uploadingAsset"
          :upload-error="uploadError"
          :pending-license-assets="pendingLicenseAssets"
          :license-draft-for="licenseDraftFor"
          :confirming-license-asset-id="confirmingLicense"
          :selectable-font-assets="selectableFontAssets"
          :active-font-asset-ids="{ display: activeFontAssetId('display'), body: activeFontAssetId('body') }"
          :locked="lockedForActiveLevel"
          :asset-origin="assetOrigin"
          @select-pairing="selectFontPairing"
          @upload="uploadAsset($event, 'font')"
          @confirm-license="confirmLicense"
          @toggle-font="toggleFontAsset"
        />
      </div>

      <p v-if="errorMessage" class="mt-4 text-sm text-amber-800">{{ errorMessage }}</p>
    </template>
  </div>
</template>
