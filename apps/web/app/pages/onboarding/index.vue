<script setup lang="ts">
import { AlertTriangle, ArrowRight, Check, ShieldCheck, Sparkles, Upload } from '@lucide/vue'

definePageMeta({ layout: false })

const config = useRuntimeConfig()
const step = useState('onboarding-step', () => 1)
const organizationId = useState<string | null>('onboarding-organization-id', () => null)
const createdSlug = useState<string | null>('onboarding-slug', () => null)
const submitting = ref(false)
const errorMessage = ref('')

const org = useState('onboarding-org-form', () => ({
  name: '',
  legalForm: '',
  street: '',
  houseNumber: '',
  postalCode: '',
  city: '',
  contactEmail: '',
  websiteUrl: '',
  foundedYear: '',
  timezone: 'Europe/Berlin',
}))
const legalForms: { id: string; label: string }[] = [
  { id: 'e_v', label: 'eingetragener Verein (e. V.)' },
  { id: 'gmbh', label: 'GmbH' },
  { id: 'gugmbh', label: 'gemeinnützige UG (haftungsbeschränkt)' },
  { id: 'ggmbh', label: 'gemeinnützige GmbH' },
  { id: 'nicht_eingetragen', label: 'nicht eingetragener Verein' },
  { id: 'sonstige', label: 'Sonstige' },
]
const slugPreview = computed(() => trim(org.value.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'verein')
function trim(value: string) { return value.trim() }
const legalFormModel = computed({
  get: () => org.value.legalForm || '__none__',
  set: (value: string) => { org.value.legalForm = value === '__none__' ? '' : value },
})

const departmentName = useState('onboarding-department-name', () => '')
const departmentSuggestions = ['Fußball', 'Handball', 'Turnen', 'Leichtathletik', 'Schwimmen', 'Tennis', 'Volleyball', 'Basketball', 'Tischtennis', 'Gesamtverein']

const brand = useState('onboarding-brand-form', () => ({ primaryColor: '#163a2c', accentColor: '#caff4a' }))
const logoFile = ref<File | null>(null)
const logoPreviewUrl = ref('')
const logoSanitizedNotice = ref(false)

function hexToRgb(hex: string) {
  const parsed = Number.parseInt(hex.replace('#', ''), 16)
  return { r: (parsed >> 16) & 255, g: (parsed >> 8) & 255, b: parsed & 255 }
}
function relativeLuminance({ r, g, b }: { r: number; g: number; b: number }) {
  const channel = (value: number) => { const s = value / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}
function contrastRatio(hexA: string, hexB: string) {
  const a = relativeLuminance(hexToRgb(hexA))
  const b = relativeLuminance(hexToRgb(hexB))
  const [light, dark] = a > b ? [a, b] : [b, a]
  return (light + 0.05) / (dark + 0.05)
}
const primaryContrastWithWhite = computed(() => contrastRatio(brand.value.primaryColor, '#ffffff'))
const lowContrastWarning = computed(() => primaryContrastWithWhite.value < 4.5)


async function submitOrganization() {
  if (!org.value.name.trim() || !departmentName.value.trim()) {
    errorMessage.value = 'Bitte Vereinsnamen und erste Abteilung angeben.'
    return
  }
  submitting.value = true
  errorMessage.value = ''
  try {
    const headers = await useAuthHeader()
    if (!organizationId.value) {
      const created = await $fetch<{ organizationId: string; slug: string }>(`${config.public.apiBase}/v1/organizations`, {
        method: 'POST',
        headers,
        body: { name: org.value.name.trim(), firstDepartmentName: departmentName.value.trim(), timezone: org.value.timezone },
      })
      organizationId.value = created.organizationId
      createdSlug.value = created.slug
    }

    const profilePatch: Record<string, unknown> = {}
    if (org.value.legalForm) profilePatch.legalForm = org.value.legalForm
    if (org.value.street.trim()) profilePatch.street = org.value.street.trim()
    if (org.value.houseNumber.trim()) profilePatch.houseNumber = org.value.houseNumber.trim()
    if (org.value.postalCode.trim()) profilePatch.postalCode = org.value.postalCode.trim()
    if (org.value.city.trim()) profilePatch.city = org.value.city.trim()
    if (org.value.contactEmail.trim()) profilePatch.contactEmail = org.value.contactEmail.trim()
    if (org.value.websiteUrl.trim()) profilePatch.websiteUrl = org.value.websiteUrl.trim()
    if (org.value.foundedYear.trim()) profilePatch.foundedYear = Number(org.value.foundedYear)
    if (Object.keys(profilePatch).length > 0) {
      await $fetch(`${config.public.apiBase}/v1/organizations/${organizationId.value}/profile`, {
        method: 'PATCH',
        headers,
        body: profilePatch,
      })
    }

    await refreshSession()
    step.value = 3
  } catch (error) {
    errorMessage.value =
      (error as { response?: { status?: number } })?.response?.status === 429
        ? 'Ihr habt bereits die maximale Anzahl an Vereinen für dieses Konto erreicht. Bitte meldet euch bei uns.'
        : 'Der Verein konnte nicht angelegt werden. Bitte Angaben prüfen und erneut versuchen.'
  } finally {
    submitting.value = false
  }
}

function onLogoSelected(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0] ?? null
  if (logoPreviewUrl.value) URL.revokeObjectURL(logoPreviewUrl.value)
  logoFile.value = file
  logoPreviewUrl.value = file ? URL.createObjectURL(file) : ''
}

async function saveBranding() {
  if (!organizationId.value) return
  submitting.value = true
  errorMessage.value = ''
  try {
    const headers = await useAuthHeader()
    if (logoFile.value) {
      const formData = new FormData()
      formData.append('variant', 'light')
      formData.append('file', logoFile.value)
      const uploaded = await $fetch<{ signedUrl: string; sanitized: boolean }>(
        `${config.public.apiBase}/v1/organizations/${organizationId.value}/brand/logo`,
        { method: 'POST', headers, body: formData },
      )
      URL.revokeObjectURL(logoPreviewUrl.value)
      logoPreviewUrl.value = uploaded.signedUrl
      logoSanitizedNotice.value = uploaded.sanitized
    }
    await $fetch(`${config.public.apiBase}/v1/organizations/${organizationId.value}/brand`, {
      method: 'PUT',
      headers,
      body: {
        primaryColor: brand.value.primaryColor,
        accentColor: brand.value.accentColor,
        // Hintergrund-/Text-/Kontrastfarbe werden im Onboarding nicht erhoben (siehe /marke) --
        // PUT /brand ersetzt alle Felder, deshalb hier dieselben Defaults wie das Formular auf
        // /marke, statt den Nutzer danach zu fragen.
        backgroundColor: '#f6f4ec',
        textColor: '#122820',
        onPrimaryColor: '#ffffff',
        displayFontKey: 'manrope',
        bodyFontKey: 'dm_sans',
      },
    })
    await $fetch(`${config.public.apiBase}/v1/onboarding/steps/branding/complete`, { method: 'POST', headers, body: { organizationId: organizationId.value } })
    step.value = 4
  } catch {
    errorMessage.value = 'Das Erscheinungsbild konnte nicht gespeichert werden.'
  } finally {
    submitting.value = false
  }
}

function skipBranding() { step.value = 4 }

async function finishOnboarding() {
  await refreshSession()
  await navigateTo('/')
}

async function confirmResponsiblePerson() {
  if (!organizationId.value) return
  submitting.value = true
  errorMessage.value = ''
  try {
    const headers = await useAuthHeader()
    const session = await useSession()
    await $fetch(`${config.public.apiBase}/v1/organizations/${organizationId.value}/profile`, {
      method: 'PATCH',
      headers,
      body: { responsiblePersonProfileId: session.value?.userId },
    })
    await $fetch(`${config.public.apiBase}/v1/onboarding/steps/responsible_person/complete`, { method: 'POST', headers, body: { organizationId: organizationId.value } })
    await finishOnboarding()
  } catch {
    errorMessage.value = 'Konnte nicht gespeichert werden. Bitte erneut versuchen.'
  } finally {
    submitting.value = false
  }
}

const session = await useSession()
</script>

<template>
  <div class="grid min-h-screen place-items-start justify-center bg-oat px-4 py-10 sm:place-items-center">
    <div class="w-full max-w-[640px]">
      <div class="mb-7 flex justify-center">
        <div class="inline-flex rounded-xl bg-forest px-3 py-2"><AppLogo /></div>
      </div>

      <div class="mb-6 flex items-center justify-center gap-2" role="progressbar" :aria-valuenow="step" aria-valuemin="1" aria-valuemax="4">
        <div v-for="n in 4" :key="n" class="h-1.5 w-10 rounded-full" :class="n <= step ? 'bg-forest' : 'bg-[#e1e2db]'" />
      </div>

      <div class="card p-6 sm:p-8">
        <!-- Schritt 1: Verein -->
        <template v-if="step === 1">
          <div class="mb-6"><div class="eyebrow mb-3">Schritt 1 von 4</div><h1 class="font-display text-2xl font-extrabold tracking-[-.03em]">Euer Verein</h1><p class="mt-2 text-sm text-[#6c756f]">Nur der Name ist Pflicht — den Rest könnt ihr auch später ergänzen.</p></div>
          <div class="grid gap-4">
            <label><span class="mb-1.5 block text-xs font-semibold">Vereinsname *</span><input v-model="org.name" required class="focus-ring w-full rounded-xl border border-[#dfe0d9] p-3 text-sm" /></label>
            <p class="text-[11px] text-[#8a9086]">Adresse: vereinsfunk.app/{{ slugPreview }}</p>
            <label><span class="mb-1.5 block text-xs font-semibold">Rechtsform</span>
              <Select v-model="legalFormModel">
                <SelectTrigger class="p-3 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Keine Angabe</SelectItem>
                  <SelectItem v-for="item in legalForms" :key="item.id" :value="item.id">{{ item.label }}</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <div class="grid grid-cols-3 gap-3">
              <label class="col-span-2"><span class="mb-1.5 block text-xs font-semibold">Straße</span><input v-model="org.street" class="focus-ring w-full rounded-xl border border-[#dfe0d9] p-3 text-sm" /></label>
              <label><span class="mb-1.5 block text-xs font-semibold">Nr.</span><input v-model="org.houseNumber" class="focus-ring w-full rounded-xl border border-[#dfe0d9] p-3 text-sm" /></label>
            </div>
            <div class="grid grid-cols-3 gap-3">
              <label><span class="mb-1.5 block text-xs font-semibold">PLZ</span><input v-model="org.postalCode" class="focus-ring w-full rounded-xl border border-[#dfe0d9] p-3 text-sm" /></label>
              <label class="col-span-2"><span class="mb-1.5 block text-xs font-semibold">Ort</span><input v-model="org.city" class="focus-ring w-full rounded-xl border border-[#dfe0d9] p-3 text-sm" /></label>
            </div>
            <div class="grid gap-4 sm:grid-cols-2">
              <label><span class="mb-1.5 block text-xs font-semibold">Kontakt-E-Mail</span><input v-model="org.contactEmail" type="email" class="focus-ring w-full rounded-xl border border-[#dfe0d9] p-3 text-sm" /></label>
              <label><span class="mb-1.5 block text-xs font-semibold">Website</span><input v-model="org.websiteUrl" type="url" placeholder="https://" class="focus-ring w-full rounded-xl border border-[#dfe0d9] p-3 text-sm" /></label>
            </div>
            <div class="grid gap-4 sm:grid-cols-2">
              <label><span class="mb-1.5 block text-xs font-semibold">Gründungsjahr</span><input v-model="org.foundedYear" type="number" min="1800" max="2100" class="focus-ring w-full rounded-xl border border-[#dfe0d9] p-3 text-sm" /></label>
              <label><span class="mb-1.5 block text-xs font-semibold">Zeitzone</span><input v-model="org.timezone" class="focus-ring w-full rounded-xl border border-[#dfe0d9] p-3 text-sm" /></label>
            </div>
          </div>
          <p v-if="errorMessage" class="mt-4 text-sm text-amber-800">{{ errorMessage }}</p>
          <div class="mt-7 flex justify-end"><button class="focus-ring flex items-center gap-2 rounded-xl bg-forest px-6 py-3 text-xs font-bold text-white disabled:opacity-60" :disabled="!org.name.trim()" @click="step = 2">Weiter <ArrowRight :size="14" /></button></div>
        </template>

        <!-- Schritt 2: Erste Abteilung -->
        <template v-else-if="step === 2">
          <div class="mb-6"><div class="eyebrow mb-3">Schritt 2 von 4</div><h1 class="font-display text-2xl font-extrabold tracking-[-.03em]">Eure erste Abteilung</h1><p class="mt-2 text-sm text-[#6c756f]">Teams entstehen später innerhalb einer Abteilung. Ohne eigene Struktur wählt ihr „Gesamtverein“.</p></div>
          <label><span class="mb-1.5 block text-xs font-semibold">Abteilungsname *</span><input v-model="departmentName" required class="focus-ring w-full rounded-xl border border-[#dfe0d9] p-3 text-sm" /></label>
          <div class="mt-4 flex flex-wrap gap-2">
            <button v-for="suggestion in departmentSuggestions" :key="suggestion" type="button" class="focus-ring rounded-full border border-[#dfe0d9] px-3 py-1.5 text-xs font-semibold hover:bg-stone-100" @click="departmentName = suggestion">{{ suggestion }}</button>
          </div>
          <p v-if="errorMessage" class="mt-4 text-sm text-amber-800">{{ errorMessage }}</p>
          <div class="mt-7 flex justify-between">
            <button class="focus-ring rounded-xl border border-[#dadcd4] bg-white px-5 py-3 text-xs font-semibold" @click="step = 1">Zurück</button>
            <button class="focus-ring flex items-center gap-2 rounded-xl bg-forest px-6 py-3 text-xs font-bold text-white disabled:opacity-60" :disabled="submitting || !departmentName.trim()" @click="submitOrganization">{{ submitting ? 'Wird angelegt …' : 'Verein anlegen' }} <ArrowRight :size="14" /></button>
          </div>
        </template>

        <!-- Schritt 3: Erscheinungsbild -->
        <template v-else-if="step === 3">
          <div class="mb-6"><div class="eyebrow mb-3">Schritt 3 von 4 · überspringbar</div><h1 class="font-display text-2xl font-extrabold tracking-[-.03em]">Euer Erscheinungsbild</h1><p class="mt-2 text-sm text-[#6c756f]">Logo und Farben prägen jede Vorschau. Ihr könnt das jederzeit unter „Marke“ nachholen.</p></div>
          <div class="grid gap-6 sm:grid-cols-2">
            <div>
              <label class="focus-ring flex cursor-pointer flex-col items-center rounded-2xl border border-dashed border-[#cfd2cb] px-6 py-6 text-center">
                <input type="file" accept="image/png,image/jpeg,image/svg+xml" class="sr-only" @change="onLogoSelected" />
                <Upload :size="20" class="mb-2 text-forest" />
                <span class="text-xs font-semibold">{{ logoFile ? logoFile.name : 'Logo hochladen (PNG, JPEG oder SVG)' }}</span>
              </label>
              <p v-if="logoSanitizedNotice" class="mt-2 flex items-center gap-1.5 text-[11px] text-amber-800"><AlertTriangle :size="13" /> Das SVG enthielt nicht unterstützte Elemente, die entfernt wurden.</p>
              <div class="mt-5 grid grid-cols-2 gap-4">
                <label><span class="mb-1.5 block text-xs font-semibold">Primärfarbe</span><div class="flex items-center gap-2 rounded-xl border border-[#dfe0d9] bg-white p-2"><input v-model="brand.primaryColor" type="color" class="h-8 w-8 border-0 bg-transparent" /><span class="text-xs">{{ brand.primaryColor }}</span></div></label>
                <label><span class="mb-1.5 block text-xs font-semibold">Akzentfarbe</span><div class="flex items-center gap-2 rounded-xl border border-[#dfe0d9] bg-white p-2"><input v-model="brand.accentColor" type="color" class="h-8 w-8 border-0 bg-transparent" /><span class="text-xs">{{ brand.accentColor }}</span></div></label>
              </div>
              <p v-if="lowContrastWarning" class="mt-2 flex items-center gap-1.5 text-[11px] text-amber-800"><AlertTriangle :size="13" /> Diese Primärfarbe hat wenig Kontrast zu weißem Text (WCAG AA empfiehlt mindestens 4,5:1).</p>
              <p class="mt-4 text-[11px] text-[#8a9086]">Schriftpaar: Manrope / DM Sans. Weitere Schriften folgen mit dem Marken-Baustein.</p>
            </div>
            <div class="relative overflow-hidden rounded-[22px] p-6 text-white shadow-xs" :style="{ backgroundColor: brand.primaryColor }">
              <img v-if="logoPreviewUrl" :src="logoPreviewUrl" alt="Vereinslogo" class="mb-4 h-10 w-10 rounded-lg bg-white/10 object-contain p-1" />
              <p class="eyebrow !text-white/60">Vorschau</p>
              <h2 class="mt-3 font-display text-xl font-extrabold leading-tight tracking-[-.035em]">Euer nächster Beitrag könnte so aussehen.</h2>
              <span class="mt-6 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold" :style="{ backgroundColor: brand.accentColor, color: brand.primaryColor }"><Sparkles :size="13" /> Mehr erfahren</span>
            </div>
          </div>
          <p v-if="errorMessage" class="mt-4 text-sm text-amber-800">{{ errorMessage }}</p>
          <div class="mt-7 flex justify-between">
            <button class="focus-ring rounded-xl border border-[#dadcd4] bg-white px-5 py-3 text-xs font-semibold" @click="skipBranding">Später erledigen</button>
            <button class="focus-ring flex items-center gap-2 rounded-xl bg-forest px-6 py-3 text-xs font-bold text-white disabled:opacity-60" :disabled="submitting" @click="saveBranding">{{ submitting ? 'Wird gespeichert …' : 'Speichern und weiter' }} <ArrowRight :size="14" /></button>
          </div>
        </template>

        <!-- Schritt 4: Verantwortung und Team -->
        <template v-else>
          <div class="mb-6"><div class="eyebrow mb-3">Schritt 4 von 4 · überspringbar</div><h1 class="font-display text-2xl font-extrabold tracking-[-.03em]">Verantwortung und Team</h1><p class="mt-2 text-sm text-[#6c756f]">Die verantwortliche Person zeichnet rechtlich für veröffentlichte Inhalte verantwortlich.</p></div>
          <div class="flex items-start gap-3 rounded-xl border border-[#e1e2db] bg-[#f7f8f3] p-4">
            <ShieldCheck :size="18" class="mt-0.5 shrink-0 text-forest" />
            <div><p class="text-sm font-semibold">{{ session?.displayName }}</p><p class="mt-1 text-[11px] text-[#7b827d]">Als Ersteller:in seid ihr vorbelegt. Weitere Vereinsmitglieder können sich erst einladen lassen, sobald Paket 010 fertig ist — bis dahin bleibt diese Wahl auf euch beschränkt.</p></div>
          </div>
          <div class="mt-6 rounded-xl border border-dashed border-[#dadcd4] p-4 text-center text-xs text-[#8a9086]">Einladungen folgen.</div>
          <p v-if="errorMessage" class="mt-4 text-sm text-amber-800">{{ errorMessage }}</p>
          <div class="mt-7 flex justify-between">
            <button class="focus-ring rounded-xl border border-[#dadcd4] bg-white px-5 py-3 text-xs font-semibold" @click="finishOnboarding">Später erledigen</button>
            <button class="focus-ring flex items-center gap-2 rounded-xl bg-forest px-6 py-3 text-xs font-bold text-white disabled:opacity-60" :disabled="submitting" @click="confirmResponsiblePerson">{{ submitting ? 'Wird gespeichert …' : 'Bestätigen' }} <Check :size="14" /></button>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
