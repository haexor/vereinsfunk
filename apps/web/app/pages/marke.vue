<script setup lang="ts">
import { AlertTriangle, Check, LoaderCircle, Sparkles, Upload } from '@lucide/vue'
import {
  BRAND_LOCKABLE_FIELDS,
  curatedFontPairings,
  meetsMinimumContrast,
  MINIMUM_AA_CONTRAST,
  resolveBrand,
} from '@vereinsfunk/domain'
import { BrandAssetSchema, type BrandWebsiteAnalysisResult } from '@vereinsfunk/contracts'
import {
  type BrandOrganizationState,
  type BrandScopeLevel,
  useBrandAssets,
} from '../composables/useBrandAssets'
import { useBrandOverrides } from '../composables/useBrandOverrides'
import { useBrandWebsiteAnalysis } from '../composables/useBrandWebsiteAnalysis'
import { ApiRequestError } from '../utils/apiClient'

type ScopeLevelName = BrandScopeLevel

interface DepartmentRow {
  id: string
  name: string
}
interface TeamRow {
  id: string
  name: string
  departmentId: string
}

// Genau BRAND_LOCKABLE_FIELDS aus packages/domain, nur mit deutschem Etikett: eine Sperre wirkt
// ausschliesslich auf Felder, die eine Abteilung/Mannschaft ueberhaupt selbst fuehren kann.
const LOCKABLE_FIELD_LABELS: Readonly<Record<string, string>> = {
  primaryColor: 'Primärfarbe',
  accentColor: 'Akzentfarbe',
  logoAssetId: 'Logo',
  websiteUrl: 'Website-Adresse',
  displayFontAssetId: 'Eigene Überschriften-Schrift',
  bodyFontAssetId: 'Eigene Fließtext-Schrift',
}
const LOCKABLE_FIELDS = BRAND_LOCKABLE_FIELDS.map((key) => ({
  key,
  label: LOCKABLE_FIELD_LABELS[key]!,
}))

const api = useApiClient()
const scope = await useScope()
const organizationId = computed(() => scope.value?.organizationId ?? null)
const supabase = useSupabaseClient()

const loading = ref(true)
const loadError = ref(false)
const saving = ref(false)
const errorMessage = ref('')

const departments = ref<DepartmentRow[]>([])
const teams = ref<TeamRow[]>([])

const activeLevel = ref<ScopeLevelName>('organization')
const activeDepartmentId = ref<string | null>(null)
const activeTeamId = ref<string | null>(null)

const org = reactive<BrandOrganizationState>({
  primaryColor: '#163a2c',
  accentColor: '#caff4a',
  backgroundColor: '#f6f4ec',
  textColor: '#122820',
  onPrimaryColor: '#ffffff',
  displayFontKey: 'manrope',
  bodyFontKey: 'dm_sans',
  displayFontAssetId: null as string | null,
  bodyFontAssetId: null as string | null,
  logoAssetId: null as string | null,
  websiteUrl: null as string | null,
  allowDepartmentOverrides: true,
  lockedFields: [] as string[],
})
const {
  departmentOverrides,
  teamOverrides,
  readOverride,
  readTeamOverride,
  overrideFor,
  teamOverrideFor,
} = useBrandOverrides()

const activeDepartmentOverride = computed(() =>
  activeDepartmentId.value ? readOverride(activeDepartmentId.value) : null,
)
const activeTeamOverride = computed(() =>
  activeTeamId.value ? readTeamOverride(activeTeamId.value) : null,
)

// Sperren wirken nur nach unten: eine Vereinssperre gilt auch fuer die Mannschaft, selbst wenn
// die Abteilung sie nicht wiederholt (siehe packages/domain/src/brand.ts, resolveBrand).
const lockedForActiveLevel = computed<Set<string>>(() => {
  const locked = new Set<string>()
  if (activeLevel.value === 'organization') return locked
  for (const field of org.lockedFields) locked.add(field)
  if (activeLevel.value === 'team' && activeDepartmentId.value) {
    for (const field of readOverride(activeDepartmentId.value).lockedFields ?? []) locked.add(field)
  }
  return locked
})

const resolved = computed(() => {
  const departmentLevel = activeDepartmentId.value ? readOverride(activeDepartmentId.value) : null
  const teamLevel = activeLevel.value === 'team' ? activeTeamOverride.value : null
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
    teamLevel,
  )
})

const contrastChecks = computed(() => [
  {
    label: 'Text auf Hintergrund',
    ...meetsMinimumContrast(resolved.value.textColor, resolved.value.backgroundColor),
  },
  {
    label: 'Auf-Primär-Text auf Primärfarbe',
    ...meetsMinimumContrast(resolved.value.onPrimaryColor, resolved.value.primaryColor),
  },
  {
    label: 'Text auf Akzentfarbe',
    ...meetsMinimumContrast(resolved.value.textColor, resolved.value.accentColor),
  },
])

async function loadAll() {
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
      loadError.value = true
      return
    }
    if (brandResult.data) {
      org.primaryColor = brandResult.data.primary_color
      org.accentColor = brandResult.data.accent_color
      org.backgroundColor = brandResult.data.background_color
      org.textColor = brandResult.data.text_color
      org.onPrimaryColor = brandResult.data.on_primary_color
      org.displayFontKey = brandResult.data.display_font_key
      org.bodyFontKey = brandResult.data.body_font_key
      org.displayFontAssetId = brandResult.data.display_font_asset_id
      org.bodyFontAssetId = brandResult.data.body_font_asset_id
      org.logoAssetId = brandResult.data.logo_asset_id
      org.websiteUrl = brandResult.data.website_url
      org.allowDepartmentOverrides = brandResult.data.allow_department_overrides
      org.lockedFields = brandResult.data.locked_fields ?? []
    }
    departments.value = departmentsResult.data.map((row) => ({ id: row.id, name: row.name }))
    teams.value = teamsResult.data.map((row) => ({
      id: row.id,
      name: row.name,
      departmentId: row.department_id,
    }))
    departmentOverrides.value = {}
    for (const row of departmentProfilesResult.data) {
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
        lockedFields: row.locked_fields ?? [],
      }
    }
    teamOverrides.value = {}
    for (const row of teamProfilesResult.data) {
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
    assets.value = assetsResult.data.map((row) => ({
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
    }))
    // Hat die aktive Ebene serverseitig noch kein Profil, muss der leere Eintrag hier neu
    // entstehen -- die Formularfelder schreiben direkt hinein, und ein computed darf ihn nicht
    // mehr nachtraeglich anlegen.
    if (activeLevel.value === 'department' && activeDepartmentId.value)
      overrideFor(activeDepartmentId.value)
    if (activeLevel.value === 'team' && activeTeamId.value) teamOverrideFor(activeTeamId.value)
  } finally {
    loading.value = false
  }
}
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

// Alte Asset-Arten werden beim Anzeigen bewusst nicht mehr unterschieden. Die Datenmigration
// vereinheitlicht sie auf logo_primary; diese Zuordnung hält auch wiederhergestellte Altbestände
// verständlich.
const LOGO_ASSET_LABEL = 'Logo'

// Paket 048: KI-gestuetzte Markenerkennung aus der Homepage -- fuellt nur Formularfelder vor,
// speichert nichts selbst (siehe Plandokument 048). Seit Paket 049 auch pro Abteilung, mit
// eigenem Job je Scope (siehe Migration 2026082102).
//
// Die Analyse-Adresse ist Teil des Markenprofils und wird sowohl für Verein als auch Abteilung
// beim normalen Speichern dauerhaft abgelegt.
const websiteAnalysisUrl = computed({
  get: () =>
    activeLevel.value === 'organization'
      ? (org.websiteUrl ?? '')
      : activeLevel.value === 'department'
        ? (activeDepartmentOverride.value?.websiteUrl ?? '')
        : '',
  set: (value) => {
    if (activeLevel.value === 'organization') org.websiteUrl = value || null
    else if (activeLevel.value === 'department' && activeDepartmentId.value)
      overrideFor(activeDepartmentId.value).websiteUrl = value || null
  },
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
// Bildet die technischen error_reason-Werte des Workers (z.B. "provider_rate_limit",
// "secret_configuration") auf wenige verständliche Gründe ab, statt sie roh anzuzeigen --
// siehe Plandokument 048, Abschnitt "Abweichungen".
const websiteAnalysisFailureMessage = computed(() => {
  if (websiteAnalysisStatus.value !== 'failed') return ''
  const reason = websiteAnalysisErrorReason.value
  if (reason === 'timeout') return 'Die Analyse hat zu lange gedauert. Bitte erneut versuchen.'
  if (reason === 'website_unreachable' || reason === 'blocked_url')
    return 'Die Webseite konnte nicht geladen werden. Bitte die Adresse prüfen und erneut versuchen.'
  return 'Die Analyse ist fehlgeschlagen. Bitte später erneut versuchen.'
})

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
  await requestWebsiteAnalysis(websiteAnalysisUrl.value)
}

await loadAll()

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
  await api.request(`/v1/departments/${departmentId}/brand`, {
    method: 'PUT',
    body: {
      primaryColor: value.primaryColor,
      accentColor: value.accentColor,
      logoAssetId: value.logoAssetId,
      displayFontAssetId: value.displayFontAssetId,
      bodyFontAssetId: value.bodyFontAssetId,
      websiteUrl: value.websiteUrl,
      allowTeamOverrides: value.allowTeamOverrides,
      lockedFields: value.lockedFields,
    },
  })
}

async function saveTeam(teamId: string) {
  const value = teamOverrideFor(teamId)
  await api.request(`/v1/teams/${teamId}/brand`, {
    method: 'PUT',
    body: {
      primaryColor: value.primaryColor,
      accentColor: value.accentColor,
      logoAssetId: value.logoAssetId,
      displayFontAssetId: value.displayFontAssetId,
      bodyFontAssetId: value.bodyFontAssetId,
    },
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
    else if (activeLevel.value === 'team' && activeTeamId.value) await saveTeam(activeTeamId.value)
    await loadAll()
  } catch (error) {
    errorMessage.value =
      error instanceof ApiRequestError && error.code === 'invalid_logo' && error.data.message
        ? `Logo konnte nicht gespeichert werden: ${error.data.message}`
        : 'Die Marke konnte nicht gespeichert werden. Bitte erneut versuchen.'
  } finally {
    saving.value = false
  }
}

function selectScope(level: ScopeLevelName, departmentId: string | null, teamId: string | null) {
  // Hier -- im Event-Handler, nicht in einem computed -- entsteht der Eintrag, in den die
  // Formularfelder der gewaehlten Ebene anschliessend schreiben.
  if (level === 'department' && departmentId) overrideFor(departmentId)
  if (level === 'team' && teamId) teamOverrideFor(teamId)
  activeLevel.value = level
  activeDepartmentId.value = departmentId
  activeTeamId.value = teamId
}
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
      <!-- Scope-Umschalter -->
      <!-- Der aktive Bereich darf nicht allein an der Farbe haengen, sonst meldet ein Screenreader
           ihn gar nicht -- daher aria-pressed je Schaltflaeche und eine Gruppenbeschriftung. -->
      <div
        class="card mb-6 flex flex-wrap items-center gap-2 p-4"
        role="group"
        aria-label="Markenebene wählen"
      >
        <button
          type="button"
          :aria-pressed="activeLevel === 'organization'"
          class="focus-ring rounded-lg px-3 py-1.5 text-xs font-semibold"
          :class="
            activeLevel === 'organization' ? 'bg-forest text-white' : 'bg-[#eef1ea] text-[#5b625d]'
          "
          @click="selectScope('organization', null, null)"
        >
          Verein
        </button>
        <span
          v-for="department in departments"
          :key="department.id"
          class="flex items-center gap-1"
        >
          <button
            type="button"
            :aria-pressed="activeLevel === 'department' && activeDepartmentId === department.id"
            class="focus-ring rounded-lg px-3 py-1.5 text-xs font-semibold"
            :class="
              activeLevel === 'department' && activeDepartmentId === department.id
                ? 'bg-forest text-white'
                : 'bg-[#eef1ea] text-[#5b625d]'
            "
            @click="selectScope('department', department.id, null)"
          >
            {{ department.name }}
          </button>
          <button
            v-for="team in teams.filter((t) => t.departmentId === department.id)"
            :key="team.id"
            type="button"
            :aria-pressed="activeLevel === 'team' && activeTeamId === team.id"
            class="focus-ring rounded-lg px-3 py-1.5 text-[11px] font-semibold"
            :class="
              activeLevel === 'team' && activeTeamId === team.id
                ? 'bg-forest text-white'
                : 'bg-[#f4f6f1] text-[#7b827d]'
            "
            @click="selectScope('team', department.id, team.id)"
          >
            {{ team.name }}
          </button>
        </span>
      </div>

      <div class="space-y-6">
        <!-- KI-Markenerkennung aus der Homepage (Verein oder Abteilung, füllt nur vor) -->
        <!-- Ohne allowDepartmentOverrides kann eine Abteilung ohnehin kein eigenes Branding
               speichern (PUT .../brand lehnt mit 400 overrides_not_allowed ab) -- die Karte bliebe
               sonst sichtbar und würde einen echten, kostenpflichtigen Analyse-Lauf anstoßen, dessen
               Ergebnis garantiert nicht gespeichert werden kann. -->
        <section
          v-if="
            activeLevel === 'organization' ||
            (activeLevel === 'department' && org.allowDepartmentOverrides)
          "
          class="card p-6"
        >
          <h2 class="font-display flex items-center gap-2 text-base font-bold">
            <Sparkles :size="16" /> Automatisch aus der Homepage übernehmen
          </h2>
          <p class="mt-2 text-xs text-[#7a817c]">
            {{
              activeLevel === 'department'
                ? 'Primärfarbe und Akzentfarbe aus der Homepage dieser Abteilung vorschlagen lassen.'
                : 'Primärfarbe, Akzentfarbe und eine Schriftempfehlung aus eurer Vereins-Homepage vorschlagen lassen.'
            }}
            Gefundene Logos erscheinen unten als eigene Vorschläge zum Übernehmen. Die Adresse sowie
            Farben und Schrift werden erst mit „Änderungen speichern“ unten dauerhaft übernommen.
          </p>
          <div class="mt-4 flex flex-wrap items-center gap-2">
            <input
              v-model="websiteAnalysisUrl"
              type="url"
              :placeholder="
                activeLevel === 'department'
                  ? 'https://abteilung.euer-verein.de'
                  : 'https://euer-verein.de'
              "
              class="focus-ring min-w-0 flex-1 rounded-lg border border-[#dfe0d9] px-3 py-2 text-xs"
              :disabled="websiteAnalysisRunning || websiteAnalysisStarting"
            />
            <button
              type="button"
              class="focus-ring flex items-center gap-1.5 rounded-lg bg-forest px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
              :disabled="
                websiteAnalysisRunning || websiteAnalysisStarting || !websiteAnalysisUrl.trim()
              "
              @click="startWebsiteAnalysis"
            >
              <LoaderCircle
                v-if="websiteAnalysisRunning || websiteAnalysisStarting"
                :size="14"
                class="animate-spin"
              /><Sparkles v-else :size="14" />
              {{ websiteAnalysisRunning ? 'Analyse läuft …' : 'Analyse starten' }}
            </button>
          </div>
          <p v-if="websiteAnalysisStartError" class="mt-2 text-[11px] text-amber-800">
            {{ websiteAnalysisStartError }}
          </p>
          <p v-else-if="websiteAnalysisFailureMessage" class="mt-2 text-[11px] text-amber-800">
            {{ websiteAnalysisFailureMessage }}
          </p>
          <p
            v-if="websiteAnalysisApplied"
            class="mt-2 flex items-center gap-1.5 text-[11px] text-emerald-700"
          >
            <Check :size="12" /> Farb-/Schriftvorschlag übernommen — bitte prüfen und unten
            speichern.
          </p>
          <p v-if="detectedFontNotice" class="mt-2 text-[11px] text-[#7a817c]">
            {{ detectedFontNotice }}
          </p>
          <div v-if="websiteAnalysisResult?.logoCandidates.length" class="mt-4">
            <p class="text-[11px] font-semibold text-[#7b827d]">
              Gefundene Logos — einzeln prüfen und übernehmen
            </p>
            <div class="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div
                v-for="(candidate, index) in websiteAnalysisResult.logoCandidates"
                :key="candidate.signedUrl"
                class="rounded-xl border border-[#e1e2db] p-2 text-center"
              >
                <img :src="candidate.signedUrl" alt="" class="mx-auto h-12 w-12 object-contain" />
                <button
                  type="button"
                  class="focus-ring mt-1.5 block w-full rounded-lg bg-forest px-2 py-1 text-[10px] font-bold text-white disabled:opacity-50"
                  :disabled="logoSuggestionApplied[index]"
                  @click="applyLogoSuggestion(index)"
                >
                  {{ logoSuggestionApplied[index] ? 'Übernommen' : 'Übernehmen' }}
                </button>
              </div>
            </div>
          </div>
        </section>

        <!-- Logo -->
        <section class="card p-6">
          <h2 class="font-display text-base font-bold">Logo</h2>
          <p class="mt-2 text-xs text-[#7a817c]">
            Hinterlegt die Logo-Dateien, die ihr in euren Beiträgen verwenden möchtet. „Als Logo“
            legt die aktuell verwendete Datei dieser Ebene fest.
          </p>
          <div class="mt-4 flex flex-wrap gap-2">
            <label
              class="focus-ring relative flex cursor-pointer items-center gap-1.5 rounded-lg border border-[#dfe0d9] px-3 py-1.5 text-[11px] font-semibold"
            >
              <input
                type="file"
                accept="image/png,image/jpeg,image/svg+xml"
                class="sr-only"
                :disabled="uploadingAsset"
                @change="uploadAsset($event, 'logo_primary')"
              />
              <Upload :size="12" /> Logo hochladen
            </label>
          </div>
          <div v-if="ownLogoAssets.length" class="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4">
            <div
              v-for="asset in ownLogoAssets"
              :key="asset.id"
              class="rounded-xl border p-2 text-center"
              :class="
                activeLogoAssetId() === asset.id ? 'border-forest bg-[#f2f6e9]' : 'border-[#e1e2db]'
              "
            >
              <img
                v-if="assetSignedUrls[asset.id]"
                :src="assetSignedUrls[asset.id]"
                :alt="LOGO_ASSET_LABEL"
                class="mx-auto h-12 w-12 object-contain"
              />
              <p class="mt-1 text-[9px] text-[#9aa096]">{{ LOGO_ASSET_LABEL }}</p>
              <button
                type="button"
                class="focus-ring text-[9px] underline disabled:opacity-50"
                :aria-pressed="activeLogoAssetId() === asset.id"
                :disabled="
                  activeLevel !== 'organization' && lockedForActiveLevel.has('logoAssetId')
                "
                @click="toggleLogoAsset(asset.id)"
              >
                {{ activeLogoAssetId() === asset.id ? 'Logo entfernen' : 'als Logo' }}
              </button>
              <button
                type="button"
                class="focus-ring mt-1 block w-full text-[9px] text-amber-800 underline disabled:opacity-50"
                :disabled="deletingAsset === asset.id"
                @click="removeLogo(asset.id)"
              >
                {{ deletingAsset === asset.id ? 'Wird entfernt …' : 'löschen' }}
              </button>
            </div>
          </div>
          <p v-if="deleteAssetError" class="mt-2 text-[11px] text-amber-800">
            {{ deleteAssetError }}
          </p>
          <div v-if="activeLevel !== 'organization' && selectableLogoAssets.length" class="mt-4">
            <p class="text-[11px] font-semibold text-[#7b827d]">
              Wählbar (vom Verein{{ activeLevel === 'team' ? ' oder der Abteilung' : '' }}) — erneut
              klicken entfernt die Auswahl
            </p>
            <div class="mt-2 flex flex-wrap gap-2">
              <button
                v-for="asset in selectableLogoAssets"
                :key="asset.id"
                type="button"
                class="focus-ring rounded-lg px-2 py-1 text-[10px] disabled:opacity-50"
                :class="activeLogoAssetId() === asset.id ? 'bg-forest text-white' : 'bg-[#f4f6f1]'"
                :aria-pressed="activeLogoAssetId() === asset.id"
                :disabled="lockedForActiveLevel.has('logoAssetId')"
                @click="toggleLogoAsset(asset.id)"
              >
                {{ LOGO_ASSET_LABEL }} — {{ assetOrigin(asset) }}
              </button>
            </div>
          </div>
        </section>

        <!-- Farbrollen -->
        <section class="card p-6">
          <h2 class="font-display text-base font-bold">Farbrollen</h2>
          <template v-if="activeLevel === 'organization'">
            <div class="mt-5 grid grid-cols-2 gap-4">
              <label
                v-for="field in [
                  ['primaryColor', 'Primärfarbe'],
                  ['accentColor', 'Akzentfarbe'],
                ] as const"
                :key="field[0]"
              >
                <span class="mb-2 flex items-center gap-1 text-xs font-semibold">
                  {{ field[1] }}
                  <span
                    v-if="org.lockedFields.includes(field[0])"
                    class="rounded-full bg-[#eef1ea] px-1.5 py-0.5 text-[9px] text-[#9aa096]"
                    >gesperrt für Abteilungen</span
                  >
                </span>
                <div
                  class="flex items-center gap-2 rounded-xl border border-[#dfe0d9] bg-white p-2"
                >
                  <input
                    v-model="org[field[0]]"
                    type="color"
                    class="h-8 w-8 border-0 bg-transparent"
                  />
                  <span class="text-xs">{{ org[field[0]] }}</span>
                </div>
              </label>
            </div>
            <label class="mt-4 flex items-center gap-2 text-xs">
              <input
                v-model="org.allowDepartmentOverrides"
                type="checkbox"
                class="h-4 w-4 accent-[#163a2c]"
              />
              Abteilungen dürfen eigenes Branding führen
            </label>
            <div v-if="org.allowDepartmentOverrides" class="mt-3">
              <p class="mb-2 text-[11px] font-semibold text-[#7b827d]">
                Felder für Abteilungen sperren:
              </p>
              <label
                v-for="field in LOCKABLE_FIELDS"
                :key="field.key"
                class="mr-3 inline-flex items-center gap-1.5 text-[11px]"
              >
                <input
                  type="checkbox"
                  class="h-4 w-4 accent-[#163a2c]"
                  :checked="org.lockedFields.includes(field.key)"
                  @change="
                    ($event.target as HTMLInputElement).checked
                      ? org.lockedFields.push(field.key)
                      : (org.lockedFields = org.lockedFields.filter((f) => f !== field.key))
                  "
                />
                {{ field.label }}
              </label>
            </div>
          </template>
          <template v-else-if="activeDepartmentOverride && activeLevel === 'department'">
            <p class="mt-2 text-xs text-[#7a817c]">
              Leer lassen, um die Vereinsfarbe zu übernehmen.
            </p>
            <div class="mt-4 grid grid-cols-2 gap-4">
              <label
                v-for="field in [
                  ['primaryColor', 'Primärfarbe', resolved.primaryColor],
                  ['accentColor', 'Akzentfarbe', resolved.accentColor],
                ] as const"
                :key="field[0]"
              >
                <span class="mb-2 flex items-center gap-1 text-xs font-semibold">
                  {{ field[1] }}
                  <span
                    v-if="lockedForActiveLevel.has(field[0])"
                    class="rounded-full bg-[#eef1ea] px-1.5 py-0.5 text-[9px] text-[#9aa096]"
                    >vom Verein gesperrt</span
                  >
                </span>
                <div
                  class="flex items-center gap-2 rounded-xl border border-[#dfe0d9] bg-white p-2"
                  :class="lockedForActiveLevel.has(field[0]) && 'opacity-50'"
                >
                  <input
                    :value="activeDepartmentOverride[field[0]] ?? field[2]"
                    type="color"
                    class="h-8 w-8 border-0 bg-transparent"
                    :disabled="lockedForActiveLevel.has(field[0])"
                    @input="
                      activeDepartmentOverride[field[0]] = ($event.target as HTMLInputElement).value
                    "
                  />
                  <span class="text-xs">{{
                    activeDepartmentOverride[field[0]] ?? `geerbt: ${field[2]}`
                  }}</span>
                  <button
                    v-if="activeDepartmentOverride[field[0]]"
                    class="focus-ring ml-auto text-[10px] underline"
                    @click="activeDepartmentOverride[field[0]] = null"
                  >
                    erben
                  </button>
                </div>
              </label>
            </div>
            <label class="mt-4 flex items-center gap-2 text-xs">
              <input
                v-model="activeDepartmentOverride.allowTeamOverrides"
                type="checkbox"
                class="h-4 w-4 accent-[#163a2c]"
              />
              Mannschaften dürfen eigenes Branding führen
            </label>
          </template>
          <template v-else-if="activeTeamOverride && activeLevel === 'team'">
            <p class="mt-2 text-xs text-[#7a817c]">
              Leer lassen, um die Abteilungsfarbe zu übernehmen.
            </p>
            <div class="mt-4 grid grid-cols-2 gap-4">
              <label
                v-for="field in [
                  ['primaryColor', 'Primärfarbe', resolved.primaryColor],
                  ['accentColor', 'Akzentfarbe', resolved.accentColor],
                ] as const"
                :key="field[0]"
              >
                <span class="mb-2 flex items-center gap-1 text-xs font-semibold">
                  {{ field[1] }}
                  <span
                    v-if="lockedForActiveLevel.has(field[0])"
                    class="rounded-full bg-[#eef1ea] px-1.5 py-0.5 text-[9px] text-[#9aa096]"
                    >gesperrt</span
                  >
                </span>
                <div
                  class="flex items-center gap-2 rounded-xl border border-[#dfe0d9] bg-white p-2"
                  :class="lockedForActiveLevel.has(field[0]) && 'opacity-50'"
                >
                  <input
                    :value="activeTeamOverride[field[0]] ?? field[2]"
                    type="color"
                    class="h-8 w-8 border-0 bg-transparent"
                    :disabled="lockedForActiveLevel.has(field[0])"
                    @input="
                      activeTeamOverride[field[0]] = ($event.target as HTMLInputElement).value
                    "
                  />
                  <span class="text-xs">{{
                    activeTeamOverride[field[0]] ?? `geerbt: ${field[2]}`
                  }}</span>
                  <button
                    v-if="activeTeamOverride[field[0]]"
                    class="focus-ring ml-auto text-[10px] underline"
                    @click="activeTeamOverride[field[0]] = null"
                  >
                    erben
                  </button>
                </div>
              </label>
            </div>
          </template>
          <div class="mt-5 space-y-1.5 border-t border-[#eceee7] pt-4">
            <p class="mb-1 text-[11px] font-semibold text-[#7b827d]">
              Lesbarkeit (WCAG-AA-Kontrast, mind. {{ MINIMUM_AA_CONTRAST }}:1)
            </p>
            <div
              v-for="check in contrastChecks"
              :key="check.label"
              class="flex items-center justify-between text-[11px]"
              :title="`Kontrastverhältnis ${check.ratio}:1 — WCAG AA verlangt mindestens ${MINIMUM_AA_CONTRAST}:1`"
            >
              <span class="text-[#7b827d]">{{ check.label }}</span>
              <span
                class="flex items-center gap-1 font-semibold"
                :class="check.meetsAA ? 'text-emerald-700' : 'text-amber-800'"
              >
                <AlertTriangle v-if="!check.meetsAA" :size="12" /> {{ check.ratio }}:1 ·
                {{ check.meetsAA ? 'gut lesbar' : 'schwer lesbar' }}
              </span>
            </div>
          </div>
        </section>

        <!-- Schriften -->
        <section class="card p-6">
          <h2 class="font-display text-base font-bold">Schriften</h2>
          <template v-if="activeLevel === 'organization'">
            <p class="mt-2 text-xs text-[#7a817c]">
              Kuratiertes Paar wählen oder eine eigene Schrift hochladen.
            </p>
            <div class="mt-4 grid gap-2 sm:grid-cols-2">
              <label
                v-for="pairing in curatedFontPairings"
                :key="pairing.key"
                class="focus-ring relative cursor-pointer rounded-xl border p-3"
                :class="
                  org.displayFontKey === pairing.displayFontKey
                    ? 'border-forest bg-[#f2f6e9]'
                    : 'border-[#e1e2db]'
                "
              >
                <input
                  v-model="org.displayFontKey"
                  type="radio"
                  :value="pairing.displayFontKey"
                  class="sr-only"
                  @change="org.bodyFontKey = pairing.bodyFontKey"
                />
                <strong class="block text-xs">{{ pairing.label }}</strong>
              </label>
            </div>
          </template>
          <!-- Abteilungen/Mannschaften waehlen kein eigenes kuratiertes Paar (dafuer fehlt die
                 Spalte bewusst, siehe Migration) -- nur eine eigene Schriftdatei oder Erben. -->
          <p v-else class="mt-2 text-xs text-[#7a817c]">
            Erbt das kuratierte Paar des Vereins, sofern hier keine eigene Schrift ausgewählt ist.
          </p>

          <div class="mt-6 border-t border-[#eceee7] pt-4">
            <p class="text-xs font-semibold">Eigene Schrift</p>
            <label
              class="focus-ring relative mt-2 flex w-fit cursor-pointer items-center gap-2 rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-xs font-semibold"
            >
              <input
                type="file"
                accept=".ttf,.otf,.woff2,font/ttf,font/otf,font/woff2"
                class="sr-only"
                :disabled="uploadingAsset"
                @change="uploadAsset($event, 'font')"
              />
              <LoaderCircle v-if="uploadingAsset" :size="14" class="animate-spin" /><Upload
                v-else
                :size="14"
              />
              Schriftdatei hochladen
            </label>
            <p v-if="uploadError" class="mt-2 text-[11px] text-amber-800">{{ uploadError }}</p>

            <div
              v-for="asset in pendingLicenseAssets"
              :key="asset.id"
              class="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3"
            >
              <p class="text-xs font-semibold">
                {{ asset.fontFamily }} ({{ asset.fontWeight }}, {{ asset.fontStyle }}) — Lizenz noch
                zu bestätigen
              </p>
              <input
                v-model="licenseDraftFor(asset.id).licenseHolder"
                type="text"
                placeholder="Rechteinhaber"
                class="mt-2 w-full rounded-lg border border-[#dfe0d9] px-2 py-1.5 text-xs"
              />
              <input
                v-model="licenseDraftFor(asset.id).licenseNote"
                type="text"
                placeholder="Notiz (optional)"
                class="mt-2 w-full rounded-lg border border-[#dfe0d9] px-2 py-1.5 text-xs"
              />
              <label class="mt-2 flex items-center gap-1.5 text-[11px]">
                <input
                  v-model="licenseDraftFor(asset.id).confirmed"
                  type="checkbox"
                  class="h-4 w-4 accent-[#163a2c]"
                />
                Wir besitzen eine Lizenz, die die Nutzung in unseren Social-Media-Beiträgen erlaubt.
              </label>
              <button
                class="focus-ring mt-2 rounded-lg bg-forest px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-50"
                :disabled="
                  !licenseDraftFor(asset.id).confirmed ||
                  !licenseDraftFor(asset.id).licenseHolder.trim() ||
                  confirmingLicense === asset.id
                "
                @click="confirmLicense(asset.id)"
              >
                Lizenz bestätigen
              </button>
            </div>

            <div v-if="selectableFontAssets.length" class="mt-4 space-y-1.5">
              <p class="text-[11px] font-semibold text-[#7b827d]">Verfügbare eigene Schriften</p>
              <div
                v-for="asset in selectableFontAssets"
                :key="asset.id"
                class="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#f4f6f1] px-3 py-1.5 text-[11px]"
              >
                <span>{{ asset.fontFamily }} — {{ assetOrigin(asset) }}</span>
                <span class="flex items-center gap-2">
                  <button
                    type="button"
                    class="focus-ring underline"
                    :aria-pressed="activeFontAssetId('display') === asset.id"
                    :class="activeFontAssetId('display') === asset.id && 'font-bold'"
                    @click="toggleFontAsset('display', asset.id)"
                  >
                    als Überschriften-Schrift
                  </button>
                  <button
                    type="button"
                    class="focus-ring underline"
                    :aria-pressed="activeFontAssetId('body') === asset.id"
                    :class="activeFontAssetId('body') === asset.id && 'font-bold'"
                    @click="toggleFontAsset('body', asset.id)"
                  >
                    als Fließtext-Schrift
                  </button>
                </span>
              </div>
            </div>
          </div>
        </section>
      </div>

      <p v-if="errorMessage" class="mt-4 text-sm text-amber-800">{{ errorMessage }}</p>
      <div class="mt-6 flex justify-end">
        <button
          class="focus-ring flex items-center gap-2 rounded-xl bg-forest px-5 py-3 text-xs font-bold text-white disabled:opacity-60"
          :disabled="saving"
          @click="save"
        >
          <LoaderCircle v-if="saving" :size="14" class="animate-spin" /><Check v-else :size="14" />
          {{ saving ? 'Wird gespeichert …' : 'Änderungen speichern' }}
        </button>
      </div>
    </template>
  </div>
</template>
