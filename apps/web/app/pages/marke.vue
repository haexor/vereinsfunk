<script setup lang="ts">
import { AlertTriangle, Check, LoaderCircle, Sparkles, Upload } from '@lucide/vue'
import { BRAND_LOCKABLE_FIELDS, curatedFontPairings, meetsMinimumContrast, MINIMUM_AA_CONTRAST, resolveBrand } from '@vereinsfunk/domain'
import type { BrandWebsiteAnalysisResult } from '@vereinsfunk/contracts'
import { type BrandOrganizationState, type BrandScopeLevel, useBrandAssets } from '../composables/useBrandAssets'
import { useBrandOverrides } from '../composables/useBrandOverrides'
import { useBrandWebsiteAnalysis } from '../composables/useBrandWebsiteAnalysis'
import { ApiRequestError } from '../utils/apiClient'

type ScopeLevelName = BrandScopeLevel

interface DepartmentRow { id: string, name: string }
interface TeamRow { id: string, name: string, departmentId: string }

// Genau BRAND_LOCKABLE_FIELDS aus packages/domain, nur mit deutschem Etikett: eine Sperre wirkt
// ausschliesslich auf Felder, die eine Abteilung/Mannschaft ueberhaupt selbst fuehren kann.
const LOCKABLE_FIELD_LABELS: Readonly<Record<string, string>> = {
  primaryColor: 'Primärfarbe',
  accentColor: 'Akzentfarbe',
  logoAssetId: 'Logo',
  displayFontAssetId: 'Eigene Überschriften-Schrift',
  bodyFontAssetId: 'Eigene Fließtext-Schrift',
}
const LOCKABLE_FIELDS = BRAND_LOCKABLE_FIELDS.map((key) => ({ key, label: LOCKABLE_FIELD_LABELS[key]! }))

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
  allowDepartmentOverrides: true,
  lockedFields: [] as string[],
  logoPath: null as string | null,
  logoDarkPath: null as string | null,
})
const { departmentOverrides, teamOverrides, readOverride, readTeamOverride, overrideFor, teamOverrideFor } = useBrandOverrides()

const activeDepartmentOverride = computed(() => (activeDepartmentId.value ? readOverride(activeDepartmentId.value) : null))
const activeTeamOverride = computed(() => (activeTeamId.value ? readTeamOverride(activeTeamId.value) : null))

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
        ? { ...departmentLevel, allowTeamOverrides: departmentLevel.allowTeamOverrides ?? true, lockedFields: departmentLevel.lockedFields ?? [] }
        : null,
    teamLevel,
  )
})

const contrastChecks = computed(() => [
  { label: 'Text auf Hintergrund', ...meetsMinimumContrast(resolved.value.textColor, resolved.value.backgroundColor) },
  { label: 'Auf-Primär-Text auf Primärfarbe', ...meetsMinimumContrast(resolved.value.onPrimaryColor, resolved.value.primaryColor) },
  { label: 'Text auf Akzentfarbe', ...meetsMinimumContrast(resolved.value.textColor, resolved.value.accentColor) },
])

async function loadAll() {
  if (!organizationId.value) { loading.value = false; return }
  loading.value = true
  loadError.value = false
  try {
    const [brandResult, departmentsResult, teamsResult, departmentProfilesResult, teamProfilesResult, assetsResult, organizationProfileResult] = await Promise.all([
      supabase.from('organization_brand_profiles')
        .select('primary_color, accent_color, background_color, text_color, on_primary_color, display_font_key, body_font_key, display_font_asset_id, body_font_asset_id, allow_department_overrides, locked_fields, logo_path, logo_dark_path')
        .eq('organization_id', organizationId.value).maybeSingle(),
      supabase.from('departments').select('id, name').eq('organization_id', organizationId.value).is('archived_at', null).order('name'),
      supabase.from('teams').select('id, name, department_id').eq('organization_id', organizationId.value).is('archived_at', null).order('name'),
      supabase.from('department_brand_profiles').select('department_id, primary_color, accent_color, logo_asset_id, display_font_asset_id, body_font_asset_id, allow_team_overrides, locked_fields').eq('organization_id', organizationId.value),
      supabase.from('team_brand_profiles').select('team_id, primary_color, accent_color, logo_asset_id, display_font_asset_id, body_font_asset_id').eq('organization_id', organizationId.value),
      supabase.from('brand_assets').select('id, department_id, team_id, kind, object_path, status, font_family, font_weight, font_style, license_holder, created_at').eq('organization_id', organizationId.value).order('created_at', { ascending: false }),
      supabase.from('organization_profiles').select('website_url').eq('organization_id', organizationId.value).maybeSingle(),
    ])
    if (brandResult.error || departmentsResult.error || teamsResult.error || departmentProfilesResult.error || teamProfilesResult.error || assetsResult.error || organizationProfileResult.error) {
      loadError.value = true
      return
    }
    // Nur vorausfuellen, wenn das Feld noch leer ist -- ein erneutes loadAll() (z.B. nach dem
    // Speichern) darf eine bereits vom Verein eingegebene, vom Impressum abweichende Adresse
    // nicht ueberschreiben.
    if (!websiteAnalysisUrl.value && organizationProfileResult.data?.website_url) {
      websiteAnalysisUrl.value = organizationProfileResult.data.website_url
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
      org.allowDepartmentOverrides = brandResult.data.allow_department_overrides
      org.lockedFields = brandResult.data.locked_fields ?? []
      org.logoPath = brandResult.data.logo_path
      org.logoDarkPath = brandResult.data.logo_dark_path
      if (org.logoPath) logoUrl.value = (await supabase.storage.from('brand-assets').createSignedUrl(org.logoPath, 600)).data?.signedUrl ?? ''
      if (org.logoDarkPath) logoDarkUrl.value = (await supabase.storage.from('brand-assets').createSignedUrl(org.logoDarkPath, 600)).data?.signedUrl ?? ''
    }
    departments.value = departmentsResult.data.map((row) => ({ id: row.id, name: row.name }))
    teams.value = teamsResult.data.map((row) => ({ id: row.id, name: row.name, departmentId: row.department_id }))
    departmentOverrides.value = {}
    for (const row of departmentProfilesResult.data) {
      departmentOverrides.value[row.department_id] = {
        primaryColor: row.primary_color, accentColor: row.accent_color,
        logoAssetId: row.logo_asset_id, displayFontAssetId: row.display_font_asset_id, bodyFontAssetId: row.body_font_asset_id,
        displayFontKey: null, bodyFontKey: null,
        allowTeamOverrides: row.allow_team_overrides, lockedFields: row.locked_fields ?? [],
      }
    }
    teamOverrides.value = {}
    for (const row of teamProfilesResult.data) {
      teamOverrides.value[row.team_id] = {
        primaryColor: row.primary_color, accentColor: row.accent_color,
        logoAssetId: row.logo_asset_id, displayFontAssetId: row.display_font_asset_id, bodyFontAssetId: row.body_font_asset_id,
        displayFontKey: null, bodyFontKey: null,
      }
    }
    assets.value = assetsResult.data.map((row) => ({
      id: row.id, departmentId: row.department_id, teamId: row.team_id, kind: row.kind, objectPath: row.object_path, status: row.status,
      fontFamily: row.font_family, fontWeight: row.font_weight, fontStyle: row.font_style, licenseHolder: row.license_holder, createdAt: row.created_at,
    }))
    // Hat die aktive Ebene serverseitig noch kein Profil, muss der leere Eintrag hier neu
    // entstehen -- die Formularfelder schreiben direkt hinein, und ein computed darf ihn nicht
    // mehr nachtraeglich anlegen.
    if (activeLevel.value === 'department' && activeDepartmentId.value) overrideFor(activeDepartmentId.value)
    if (activeLevel.value === 'team' && activeTeamId.value) teamOverrideFor(activeTeamId.value)
  } finally {
    loading.value = false
  }
}
const {
  assets,
  assetSignedUrls,
  logoUrl,
  logoDarkUrl,
  logoPreviewUrlLight,
  logoPreviewUrlDark,
  sanitizedNotice,
  selectableLogoAssets,
  selectableFontAssets,
  pendingLicenseAssets,
  ownLogoAssets,
  previewDisplayFamily,
  previewBodyFamily,
  previewLogoUrl,
  uploadingAsset,
  uploadError,
  confirmingLicense,
  assetOrigin,
  onLogoSelected,
  applyLogoFile,
  clearLogoFile,
  logoFileLight,
  logoFileDark,
  saveOrgLogoIfSelected,
  activeFontAssetId,
  toggleFontAsset,
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
  resolved,
  reload: loadAll,
})

// Paket 048: KI-gestuetzte Markenerkennung aus der Vereins-Homepage -- fuellt nur Formularfelder
// vor, speichert nichts selbst (siehe Plandokument 048).
const websiteAnalysisUrl = ref('')
const {
  status: websiteAnalysisStatus,
  result: websiteAnalysisResult,
  errorReason: websiteAnalysisErrorReason,
  startError: websiteAnalysisStartError,
  starting: websiteAnalysisStarting,
  startAnalysis: requestWebsiteAnalysis,
} = useBrandWebsiteAnalysis({ api, organizationId })
const websiteAnalysisRunning = computed(() => websiteAnalysisStatus.value === 'pending' || websiteAnalysisStatus.value === 'running')
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
  if (reason === 'website_unreachable' || reason === 'blocked_url') return 'Die Webseite konnte nicht geladen werden. Bitte die Adresse prüfen und erneut versuchen.'
  return 'Die Analyse ist fehlgeschlagen. Bitte später erneut versuchen.'
})

// Genau die Formate, die der Logo-Upload akzeptiert, und das multipart-Limit der API
// (apps/api/src/app.ts, fileSize 8 MiB): ein Vorschlag, den der Speicherpfad ohnehin ablehnen
// wuerde, wird gar nicht erst vorgemerkt.
const ANALYSIS_LOGO_MIME_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml']
const ANALYSIS_LOGO_MAX_BYTES = 8 * 1024 * 1024

async function applyWebsiteAnalysisResult(result: BrandWebsiteAnalysisResult) {
  org.primaryColor = result.primaryColor
  org.accentColor = result.accentColor
  org.backgroundColor = result.backgroundColor
  org.textColor = result.textColor
  org.onPrimaryColor = result.onPrimaryColor
  const pairing = curatedFontPairings.find((entry) => entry.key === result.suggestedFontPairingKey)
  if (pairing) {
    org.displayFontKey = pairing.displayFontKey
    org.bodyFontKey = pairing.bodyFontKey
    // Eine eigene Schriftdatei gewinnt in der Vorschau und beim Aufloesen ueber den Font-Key
    // (useBrandAssets.fontFamilyForPreview). Blieb sie gesetzt, war der uebernommene Vorschlag
    // unsichtbar und wurde trotzdem gespeichert -- wirksam erst, wenn das Asset irgendwann
    // entfernt wird.
    org.displayFontAssetId = null
    org.bodyFontAssetId = null
  }
  if (!result.logoCandidate) return
  try {
    const downloaded = await fetch(result.logoCandidate.signedUrl)
    // fetch lehnt bei 4xx/5xx nicht ab. Ohne diese Pruefung wuerde der Fehlerbody als Logo
    // vorgemerkt -- und weil save() das Logo vor der Marke speichert, scheiterte danach das
    // gesamte Speichern, Farben und Schriften eingeschlossen.
    if (!downloaded.ok) return
    const blob = await downloaded.blob()
    const mimeType = blob.type.split(';')[0]!.trim().toLowerCase()
    if (!ANALYSIS_LOGO_MIME_TYPES.includes(mimeType)) return
    if (blob.size === 0 || blob.size > ANALYSIS_LOGO_MAX_BYTES) return
    const extension = mimeType.split('/')[1]!.split('+')[0]
    applyLogoFile(new File([blob], `homepage-logo.${extension}`, { type: mimeType }), 'light')
  } catch {
    // Farb-/Font-Vorschlag bleibt uebernommen, auch wenn der Logo-Download im Browser scheitert.
  }
}
// Uebernommen wird nur auf der Vereinsebene: das Polling laeuft weiter, auch wenn der Nutzer
// inzwischen auf einen Abteilungs-Tab gewechselt hat. Dort waere die Uebernahme unsichtbar (der
// Block ist ausgeblendet), veraenderte aber org.* und merkte ein Logo vor, das das naechste
// Speichern zum neuen Vereinslogo gemacht haette. Wechselt der Nutzer zurueck, greift derselbe
// Watcher -- das Flag verhindert, dass ein spaeterer Ebenenwechsel eigene Aenderungen ueberschreibt.
const websiteAnalysisApplied = ref(false)
watch([websiteAnalysisStatus, activeLevel], () => {
  if (websiteAnalysisApplied.value) return
  if (websiteAnalysisStatus.value !== 'succeeded' || activeLevel.value !== 'organization') return
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
      primaryColor: org.primaryColor, accentColor: org.accentColor, backgroundColor: org.backgroundColor,
      textColor: org.textColor, onPrimaryColor: org.onPrimaryColor,
      displayFontKey: org.displayFontKey, bodyFontKey: org.bodyFontKey,
      displayFontAssetId: org.displayFontAssetId, bodyFontAssetId: org.bodyFontAssetId,
      allowDepartmentOverrides: org.allowDepartmentOverrides, lockedFields: org.lockedFields,
    },
  })
}

async function saveDepartment(departmentId: string) {
  const value = overrideFor(departmentId)
  await api.request(`/v1/departments/${departmentId}/brand`, {
    method: 'PUT',
    body: {
      primaryColor: value.primaryColor, accentColor: value.accentColor,
      logoAssetId: value.logoAssetId, displayFontAssetId: value.displayFontAssetId, bodyFontAssetId: value.bodyFontAssetId,
      allowTeamOverrides: value.allowTeamOverrides, lockedFields: value.lockedFields,
    },
  })
}

async function saveTeam(teamId: string) {
  const value = teamOverrideFor(teamId)
  await api.request(`/v1/teams/${teamId}/brand`, {
    method: 'PUT',
    body: {
      primaryColor: value.primaryColor, accentColor: value.accentColor,
      logoAssetId: value.logoAssetId, displayFontAssetId: value.displayFontAssetId, bodyFontAssetId: value.bodyFontAssetId,
    },
  })
}

async function save() {
  if (!organizationId.value) return
  saving.value = true
  errorMessage.value = ''
  try {
    // Das vorgemerkte Logo gehoert der Vereinsebene: ungefiltert aufgerufen haette ein Speichern
    // auf einem Abteilungs-Tab das Vereinslogo ersetzt (POST .../brand/logo setzt das bisherige
    // logo_primary-Asset auf 'replaced'), obwohl der Nutzer dort eine Abteilung bearbeitet.
    if (activeLevel.value === 'organization') { await saveOrgLogoIfSelected(); await saveOrganization() }
    else if (activeLevel.value === 'department' && activeDepartmentId.value) await saveDepartment(activeDepartmentId.value)
    else if (activeLevel.value === 'team' && activeTeamId.value) await saveTeam(activeTeamId.value)
    await loadAll()
  } catch (error) {
    errorMessage.value = error instanceof ApiRequestError && error.code === 'invalid_logo' && error.data.message
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
      <p class="mt-2 text-sm text-[#727a75]">So erkennt man euren Verein, seine Abteilungen und Mannschaften in jedem Beitrag wieder.</p>
    </header>

    <div v-if="loading" class="p-8 text-center text-xs text-[#7b827d]">Wird geladen …</div>
    <div v-else-if="loadError" class="card p-8 text-center text-sm font-semibold text-red-700">Die Markendaten konnten nicht geladen werden. Bitte lade die Seite neu.</div>
    <template v-else>
      <!-- Scope-Umschalter -->
      <!-- Der aktive Bereich darf nicht allein an der Farbe haengen, sonst meldet ein Screenreader
           ihn gar nicht -- daher aria-pressed je Schaltflaeche und eine Gruppenbeschriftung. -->
      <div class="card mb-6 flex flex-wrap items-center gap-2 p-4" role="group" aria-label="Markenebene wählen">
        <button type="button" :aria-pressed="activeLevel === 'organization'" class="focus-ring rounded-lg px-3 py-1.5 text-xs font-semibold" :class="activeLevel === 'organization' ? 'bg-forest text-white' : 'bg-[#eef1ea] text-[#5b625d]'" @click="selectScope('organization', null, null)">Verein</button>
        <span v-for="department in departments" :key="department.id" class="flex items-center gap-1">
          <button type="button" :aria-pressed="activeLevel === 'department' && activeDepartmentId === department.id" class="focus-ring rounded-lg px-3 py-1.5 text-xs font-semibold" :class="activeLevel === 'department' && activeDepartmentId === department.id ? 'bg-forest text-white' : 'bg-[#eef1ea] text-[#5b625d]'" @click="selectScope('department', department.id, null)">{{ department.name }}</button>
          <button v-for="team in teams.filter((t) => t.departmentId === department.id)" :key="team.id" type="button" :aria-pressed="activeLevel === 'team' && activeTeamId === team.id" class="focus-ring rounded-lg px-3 py-1.5 text-[11px] font-semibold" :class="activeLevel === 'team' && activeTeamId === team.id ? 'bg-forest text-white' : 'bg-[#f4f6f1] text-[#7b827d]'" @click="selectScope('team', department.id, team.id)">{{ team.name }}</button>
        </span>
      </div>

      <div class="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div class="space-y-6">
          <!-- KI-Markenerkennung aus der Homepage (nur Vereinsebene, füllt nur vor) -->
          <section v-if="activeLevel === 'organization'" class="card p-6">
            <h2 class="font-display flex items-center gap-2 text-base font-bold"><Sparkles :size="16" /> Automatisch aus der Homepage übernehmen</h2>
            <p class="mt-2 text-xs text-[#7a817c]">Farben, Logo und eine Schriftempfehlung aus eurer Vereins-Homepage vorschlagen lassen. Übernommen wird erst mit „Änderungen speichern“ unten.</p>
            <div class="mt-4 flex flex-wrap items-center gap-2">
              <input v-model="websiteAnalysisUrl" type="url" placeholder="https://euer-verein.de" class="focus-ring min-w-0 flex-1 rounded-lg border border-[#dfe0d9] px-3 py-2 text-xs" :disabled="websiteAnalysisRunning || websiteAnalysisStarting" />
              <button type="button" class="focus-ring flex items-center gap-1.5 rounded-lg bg-forest px-3 py-2 text-xs font-bold text-white disabled:opacity-60" :disabled="websiteAnalysisRunning || websiteAnalysisStarting || !websiteAnalysisUrl.trim()" @click="startWebsiteAnalysis">
                <LoaderCircle v-if="websiteAnalysisRunning || websiteAnalysisStarting" :size="14" class="animate-spin" /><Sparkles v-else :size="14" />
                {{ websiteAnalysisRunning ? 'Analyse läuft …' : 'Analyse starten' }}
              </button>
            </div>
            <p v-if="websiteAnalysisStartError" class="mt-2 text-[11px] text-amber-800">{{ websiteAnalysisStartError }}</p>
            <p v-else-if="websiteAnalysisFailureMessage" class="mt-2 text-[11px] text-amber-800">{{ websiteAnalysisFailureMessage }}</p>
            <p v-if="websiteAnalysisApplied" class="mt-2 flex items-center gap-1.5 text-[11px] text-emerald-700"><Check :size="12" /> Vorschlag übernommen — bitte prüfen und unten speichern.</p>
            <p v-if="detectedFontNotice" class="mt-2 text-[11px] text-[#7a817c]">{{ detectedFontNotice }}</p>
          </section>

          <!-- Logo (nur Vereinsebene: Primär/Dunkel-Upload bleibt hier, weitere Varianten unten je Ebene) -->
          <section v-if="activeLevel === 'organization'" class="card p-6">
            <h2 class="font-display text-base font-bold">Logo</h2>
            <div class="mt-5 grid grid-cols-2 gap-4">
              <div class="rounded-2xl bg-white p-4 text-center">
                <img v-if="logoPreviewUrlLight || logoUrl" :src="logoPreviewUrlLight || logoUrl" alt="Logo hell" class="mx-auto h-16 w-16 object-contain" />
                <span v-else class="grid h-16 w-16 place-items-center rounded-xl bg-[#eef1ea] font-display text-lg font-extrabold text-[#5b625d] mx-auto">?</span>
                <p class="mt-2 text-[10px] text-[#7b827d]">Auf hellem Grund</p>
                <label class="focus-ring mt-2 flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-[#dfe0d9] px-2 py-1.5 text-[11px] font-semibold">
                  <input type="file" accept="image/png,image/jpeg,image/svg+xml" class="sr-only" @change="onLogoSelected($event, 'light')" />
                  <Upload :size="12" /> Ersetzen
                </label>
                <button v-if="logoFileLight" type="button" class="focus-ring mt-1.5 w-full rounded-lg px-2 py-1 text-[11px] font-semibold text-[#7b827d] underline" @click="clearLogoFile('light')">Vorgemerktes Logo verwerfen</button>
              </div>
              <div class="rounded-2xl bg-ink p-4 text-center">
                <img v-if="logoPreviewUrlDark || logoDarkUrl" :src="logoPreviewUrlDark || logoDarkUrl" alt="Logo dunkel" class="mx-auto h-16 w-16 object-contain" />
                <span v-else class="grid h-16 w-16 place-items-center rounded-xl bg-white/10 font-display text-lg font-extrabold text-white mx-auto">?</span>
                <p class="mt-2 text-[10px] text-white/60">Auf dunklem Grund</p>
                <label class="focus-ring mt-2 flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-white/30 px-2 py-1.5 text-[11px] font-semibold text-white">
                  <input type="file" accept="image/png,image/jpeg,image/svg+xml" class="sr-only" @change="onLogoSelected($event, 'dark')" />
                  <Upload :size="12" /> Ersetzen
                </label>
                <button v-if="logoFileDark" type="button" class="focus-ring mt-1.5 w-full rounded-lg px-2 py-1 text-[11px] font-semibold text-white/70 underline" @click="clearLogoFile('dark')">Vorgemerktes Logo verwerfen</button>
              </div>
            </div>
            <p v-if="sanitizedNotice" class="mt-2 flex items-center gap-1.5 text-[11px] text-amber-800"><AlertTriangle :size="13" /> Das SVG enthielt nicht unterstützte Elemente, die entfernt wurden.</p>
          </section>

          <!-- Farbrollen -->
          <section class="card p-6">
            <h2 class="font-display text-base font-bold">Farbrollen</h2>
            <template v-if="activeLevel === 'organization'">
              <div class="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
                <label v-for="field in [['primaryColor', 'Primärfarbe'], ['accentColor', 'Akzentfarbe'], ['backgroundColor', 'Hintergrund'], ['textColor', 'Text'], ['onPrimaryColor', 'Auf Primärfarbe']] as const" :key="field[0]">
                  <span class="mb-2 flex items-center gap-1 text-xs font-semibold">
                    {{ field[1] }}
                    <span v-if="org.lockedFields.includes(field[0])" class="rounded-full bg-[#eef1ea] px-1.5 py-0.5 text-[9px] text-[#9aa096]">gesperrt für Abteilungen</span>
                  </span>
                  <div class="flex items-center gap-2 rounded-xl border border-[#dfe0d9] bg-white p-2">
                    <input v-model="org[field[0]]" type="color" class="h-8 w-8 border-0 bg-transparent" />
                    <span class="text-xs">{{ org[field[0]] }}</span>
                  </div>
                </label>
              </div>
              <label class="mt-4 flex items-center gap-2 text-xs">
                <input v-model="org.allowDepartmentOverrides" type="checkbox" class="h-4 w-4 accent-[#163a2c]" /> Abteilungen dürfen eigenes Branding führen
              </label>
              <div v-if="org.allowDepartmentOverrides" class="mt-3">
                <p class="mb-2 text-[11px] font-semibold text-[#7b827d]">Felder für Abteilungen sperren:</p>
                <label v-for="field in LOCKABLE_FIELDS" :key="field.key" class="mr-3 inline-flex items-center gap-1.5 text-[11px]">
                  <input type="checkbox" class="h-4 w-4 accent-[#163a2c]" :checked="org.lockedFields.includes(field.key)" @change="($event.target as HTMLInputElement).checked ? org.lockedFields.push(field.key) : (org.lockedFields = org.lockedFields.filter((f) => f !== field.key))" />
                  {{ field.label }}
                </label>
              </div>
            </template>
            <template v-else-if="activeDepartmentOverride && activeLevel === 'department'">
              <p class="mt-2 text-xs text-[#7a817c]">Leer lassen, um die Vereinsfarbe zu übernehmen.</p>
              <div class="mt-4 grid grid-cols-2 gap-4">
                <label v-for="field in [['primaryColor', 'Primärfarbe', resolved.primaryColor], ['accentColor', 'Akzentfarbe', resolved.accentColor]] as const" :key="field[0]">
                  <span class="mb-2 flex items-center gap-1 text-xs font-semibold">
                    {{ field[1] }}
                    <span v-if="lockedForActiveLevel.has(field[0])" class="rounded-full bg-[#eef1ea] px-1.5 py-0.5 text-[9px] text-[#9aa096]">vom Verein gesperrt</span>
                  </span>
                  <div class="flex items-center gap-2 rounded-xl border border-[#dfe0d9] bg-white p-2" :class="lockedForActiveLevel.has(field[0]) && 'opacity-50'">
                    <input :value="activeDepartmentOverride[field[0]] ?? field[2]" type="color" class="h-8 w-8 border-0 bg-transparent" :disabled="lockedForActiveLevel.has(field[0])" @input="activeDepartmentOverride[field[0]] = ($event.target as HTMLInputElement).value" />
                    <span class="text-xs">{{ activeDepartmentOverride[field[0]] ?? `geerbt: ${field[2]}` }}</span>
                    <button v-if="activeDepartmentOverride[field[0]]" class="focus-ring ml-auto text-[10px] underline" @click="activeDepartmentOverride[field[0]] = null">erben</button>
                  </div>
                </label>
              </div>
              <label class="mt-4 flex items-center gap-2 text-xs">
                <input v-model="activeDepartmentOverride.allowTeamOverrides" type="checkbox" class="h-4 w-4 accent-[#163a2c]" /> Mannschaften dürfen eigenes Branding führen
              </label>
            </template>
            <template v-else-if="activeTeamOverride && activeLevel === 'team'">
              <p class="mt-2 text-xs text-[#7a817c]">Leer lassen, um die Abteilungsfarbe zu übernehmen.</p>
              <div class="mt-4 grid grid-cols-2 gap-4">
                <label v-for="field in [['primaryColor', 'Primärfarbe', resolved.primaryColor], ['accentColor', 'Akzentfarbe', resolved.accentColor]] as const" :key="field[0]">
                  <span class="mb-2 flex items-center gap-1 text-xs font-semibold">
                    {{ field[1] }}
                    <span v-if="lockedForActiveLevel.has(field[0])" class="rounded-full bg-[#eef1ea] px-1.5 py-0.5 text-[9px] text-[#9aa096]">gesperrt</span>
                  </span>
                  <div class="flex items-center gap-2 rounded-xl border border-[#dfe0d9] bg-white p-2" :class="lockedForActiveLevel.has(field[0]) && 'opacity-50'">
                    <input :value="activeTeamOverride[field[0]] ?? field[2]" type="color" class="h-8 w-8 border-0 bg-transparent" :disabled="lockedForActiveLevel.has(field[0])" @input="activeTeamOverride[field[0]] = ($event.target as HTMLInputElement).value" />
                    <span class="text-xs">{{ activeTeamOverride[field[0]] ?? `geerbt: ${field[2]}` }}</span>
                    <button v-if="activeTeamOverride[field[0]]" class="focus-ring ml-auto text-[10px] underline" @click="activeTeamOverride[field[0]] = null">erben</button>
                  </div>
                </label>
              </div>
            </template>
            <div class="mt-5 space-y-1.5 border-t border-[#eceee7] pt-4">
              <p class="mb-1 text-[11px] font-semibold text-[#7b827d]">Lesbarkeit (WCAG-AA-Kontrast, mind. {{ MINIMUM_AA_CONTRAST }}:1)</p>
              <div v-for="check in contrastChecks" :key="check.label" class="flex items-center justify-between text-[11px]" :title="`Kontrastverhältnis ${check.ratio}:1 — WCAG AA verlangt mindestens ${MINIMUM_AA_CONTRAST}:1`">
                <span class="text-[#7b827d]">{{ check.label }}</span>
                <span class="flex items-center gap-1 font-semibold" :class="check.meetsAA ? 'text-emerald-700' : 'text-amber-800'">
                  <AlertTriangle v-if="!check.meetsAA" :size="12" /> {{ check.ratio }}:1 · {{ check.meetsAA ? 'gut lesbar' : 'schwer lesbar' }}
                </span>
              </div>
            </div>
          </section>

          <!-- Schriften -->
          <section class="card p-6">
            <h2 class="font-display text-base font-bold">Schriften</h2>
            <template v-if="activeLevel === 'organization'">
              <p class="mt-2 text-xs text-[#7a817c]">Kuratiertes Paar wählen oder eine eigene Schrift hochladen.</p>
              <div class="mt-4 grid gap-2 sm:grid-cols-2">
                <label v-for="pairing in curatedFontPairings" :key="pairing.key" class="focus-ring cursor-pointer rounded-xl border p-3" :class="org.displayFontKey === pairing.displayFontKey ? 'border-forest bg-[#f2f6e9]' : 'border-[#e1e2db]'">
                  <input v-model="org.displayFontKey" type="radio" :value="pairing.displayFontKey" class="sr-only" @change="org.bodyFontKey = pairing.bodyFontKey" />
                  <strong class="block text-xs">{{ pairing.label }}</strong>
                </label>
              </div>
            </template>
            <!-- Abteilungen/Mannschaften waehlen kein eigenes kuratiertes Paar (dafuer fehlt die
                 Spalte bewusst, siehe Migration) -- nur eine eigene Schriftdatei oder Erben. -->
            <p v-else class="mt-2 text-xs text-[#7a817c]">Erbt das kuratierte Paar des Vereins, sofern hier keine eigene Schrift ausgewählt ist.</p>

            <div class="mt-6 border-t border-[#eceee7] pt-4">
              <p class="text-xs font-semibold">Eigene Schrift</p>
              <label class="focus-ring mt-2 flex w-fit cursor-pointer items-center gap-2 rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-xs font-semibold">
                <input type="file" accept=".ttf,.otf,.woff2,font/ttf,font/otf,font/woff2" class="sr-only" :disabled="uploadingAsset" @change="uploadAsset($event, 'font')" />
                <LoaderCircle v-if="uploadingAsset" :size="14" class="animate-spin" /><Upload v-else :size="14" /> Schriftdatei hochladen
              </label>
              <p v-if="uploadError" class="mt-2 text-[11px] text-amber-800">{{ uploadError }}</p>

              <div v-for="asset in pendingLicenseAssets" :key="asset.id" class="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                <p class="text-xs font-semibold">{{ asset.fontFamily }} ({{ asset.fontWeight }}, {{ asset.fontStyle }}) — Lizenz noch zu bestätigen</p>
                <input v-model="licenseDraftFor(asset.id).licenseHolder" type="text" placeholder="Rechteinhaber" class="mt-2 w-full rounded-lg border border-[#dfe0d9] px-2 py-1.5 text-xs" />
                <input v-model="licenseDraftFor(asset.id).licenseNote" type="text" placeholder="Notiz (optional)" class="mt-2 w-full rounded-lg border border-[#dfe0d9] px-2 py-1.5 text-xs" />
                <label class="mt-2 flex items-center gap-1.5 text-[11px]">
                  <input v-model="licenseDraftFor(asset.id).confirmed" type="checkbox" class="h-4 w-4 accent-[#163a2c]" />
                  Wir besitzen eine Lizenz, die die Nutzung in unseren Social-Media-Beiträgen erlaubt.
                </label>
                <button class="focus-ring mt-2 rounded-lg bg-forest px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-50" :disabled="!licenseDraftFor(asset.id).confirmed || !licenseDraftFor(asset.id).licenseHolder.trim() || confirmingLicense === asset.id" @click="confirmLicense(asset.id)">
                  Lizenz bestätigen
                </button>
              </div>

              <div v-if="selectableFontAssets.length" class="mt-4 space-y-1.5">
                <p class="text-[11px] font-semibold text-[#7b827d]">Verfügbare eigene Schriften</p>
                <div v-for="asset in selectableFontAssets" :key="asset.id" class="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#f4f6f1] px-3 py-1.5 text-[11px]">
                  <span>{{ asset.fontFamily }} — {{ assetOrigin(asset) }}</span>
                  <span class="flex items-center gap-2">
                    <button type="button" class="focus-ring underline" :aria-pressed="activeFontAssetId('display') === asset.id" :class="activeFontAssetId('display') === asset.id && 'font-bold'" @click="toggleFontAsset('display', asset.id)">als Überschriften-Schrift</button>
                    <button type="button" class="focus-ring underline" :aria-pressed="activeFontAssetId('body') === asset.id" :class="activeFontAssetId('body') === asset.id && 'font-bold'" @click="toggleFontAsset('body', asset.id)">als Fließtext-Schrift</button>
                  </span>
                </div>
              </div>
            </div>
          </section>

          <!-- Weitere Logo-Varianten je Ebene -->
          <section class="card p-6">
            <h2 class="font-display text-base font-bold">Weitere Logovarianten</h2>
            <p class="mt-2 text-xs text-[#7a817c]">Symbol, Wortmarke oder Wasserzeichen — für Remotion und quadratische Formate.</p>
            <div class="mt-4 flex flex-wrap gap-2">
              <label v-for="kind in ['logo_mark', 'wordmark', 'watermark']" :key="kind" class="focus-ring flex cursor-pointer items-center gap-1.5 rounded-lg border border-[#dfe0d9] px-3 py-1.5 text-[11px] font-semibold">
                <input type="file" accept="image/png,image/jpeg,image/svg+xml" class="sr-only" :disabled="uploadingAsset" @change="uploadAsset($event, kind)" />
                <Upload :size="12" /> {{ kind === 'logo_mark' ? 'Symbol' : kind === 'wordmark' ? 'Wortmarke' : 'Wasserzeichen' }}
              </label>
            </div>
            <div v-if="ownLogoAssets.length" class="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4">
              <div v-for="asset in ownLogoAssets" :key="asset.id" class="rounded-xl border border-[#e1e2db] p-2 text-center">
                <img v-if="assetSignedUrls[asset.id]" :src="assetSignedUrls[asset.id]" :alt="asset.kind" class="mx-auto h-12 w-12 object-contain" />
                <p class="mt-1 text-[9px] text-[#9aa096]">{{ asset.kind }}</p>
                <button v-if="activeLevel !== 'organization'" class="focus-ring text-[9px] underline" @click="(activeLevel === 'department' ? activeDepartmentOverride! : activeTeamOverride!).logoAssetId = asset.id">als Logo</button>
              </div>
            </div>
            <div v-if="activeLevel !== 'organization' && selectableLogoAssets.length" class="mt-4">
              <p class="text-[11px] font-semibold text-[#7b827d]">Wählbar (vom Verein{{ activeLevel === 'team' ? ' oder der Abteilung' : '' }})</p>
              <div class="mt-2 flex flex-wrap gap-2">
                <button v-for="asset in selectableLogoAssets" :key="asset.id" class="focus-ring rounded-lg bg-[#f4f6f1] px-2 py-1 text-[10px]" @click="(activeLevel === 'department' ? activeDepartmentOverride! : activeTeamOverride!).logoAssetId = asset.id">{{ asset.kind }} — {{ assetOrigin(asset) }}</button>
              </div>
            </div>
          </section>
        </div>

        <div class="lg:sticky lg:top-6 lg:self-start">
          <BrandLivePreview
            :primary-color="resolved.primaryColor" :accent-color="resolved.accentColor"
            :background-color="resolved.backgroundColor" :text-color="resolved.textColor"
            :on-primary-color="resolved.onPrimaryColor" :display-font-family="previewDisplayFamily"
            :body-font-family="previewBodyFamily" :logo-url="previewLogoUrl"
          />
        </div>
      </div>

      <p v-if="errorMessage" class="mt-4 text-sm text-amber-800">{{ errorMessage }}</p>
      <div class="mt-6 flex justify-end">
        <button class="focus-ring flex items-center gap-2 rounded-xl bg-forest px-5 py-3 text-xs font-bold text-white disabled:opacity-60" :disabled="saving" @click="save">
          <LoaderCircle v-if="saving" :size="14" class="animate-spin" /><Check v-else :size="14" /> {{ saving ? 'Wird gespeichert …' : 'Änderungen speichern' }}
        </button>
      </div>
    </template>
  </div>
</template>
