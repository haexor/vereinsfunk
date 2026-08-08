<script setup lang="ts">
import { AlertTriangle, LoaderCircle } from '@lucide/vue'
import { PublicOrganizationImprintSchema, type PublicOrganizationImprint } from '@vereinsfunk/contracts'

// Oeffentliches Impressum EINES Vereins (Plan 020, Abschnitt "3."): verlinkbar aus dessen
// Instagram-/Facebook-Bio, ohne Anmeldung erreichbar -- kein noindex, im Gegensatz zu den
// Einwilligungs-Token-Seiten. Fehlende Angaben werden ehrlich als "nicht angegeben" gezeigt,
// nie als Null oder erfundener Platzhalter (Plan, "Kein erfundener Wert...").
definePageMeta({ layout: 'auth' })

const route = useRoute()
const config = useRuntimeConfig()
const organizationId = typeof route.params.organizationId === 'string' ? route.params.organizationId : ''

const LEGAL_FORM_LABELS: Record<NonNullable<PublicOrganizationImprint['legalForm']>, string> = {
  e_v: 'eingetragener Verein (e. V.)',
  gmbh: 'GmbH',
  gugmbh: 'gemeinnützige UG (haftungsbeschränkt)',
  ggmbh: 'gemeinnützige GmbH',
  nicht_eingetragen: 'nicht eingetragener Verein',
  sonstige: 'Sonstige',
}

function orNotProvided(value: string | null): string {
  return value ?? 'nicht angegeben'
}

// useAsyncData statt eines client-only onMounted-Fetches: diese Seite soll gerade OHNE
// JavaScript und fuer Suchmaschinen/Link-Vorschauen lesbar sein (kein noindex, im Gegensatz zu
// den Einwilligungs-Token-Seiten, siehe Dateikommentar oben) -- ein "if (import.meta.client)"
// haette Server-HTML nie mit dem eigentlichen Impressum ausgeliefert (gefunden im Review: die
// erste Antwort war immer nur der Ladezustand). Die Seite ist oeffentlich und nutzt keine
// Session-Composables, ist also von der bekannten SSR-Hydration-Luecke bei authentifizierten
// Seiten nicht betroffen.
const { data: imprint, error, pending } = await useAsyncData<PublicOrganizationImprint>(
  `public-imprint-${organizationId}`,
  () => $fetch(`${config.public.apiBase}/v1/organizations/${organizationId}/imprint`).then((response) => PublicOrganizationImprintSchema.parse(response)),
  { immediate: Boolean(organizationId) },
)

const status = computed<'loading' | 'ready' | 'not-found' | 'error'>(() => {
  if (!organizationId) return 'not-found'
  if (pending.value) return 'loading'
  // Nur ein 404 heisst "Verein unbekannt". Ein Transportfehler oder 429 soll nicht als
  // "Verein existiert nicht" dargestellt werden (gleiches Muster wie bei den
  // Einwilligungs-Token-Seiten).
  if (error.value) return (error.value as { statusCode?: number })?.statusCode === 404 ? 'not-found' : 'error'
  return imprint.value ? 'ready' : 'error'
})
useHead({ title: computed(() => (imprint.value ? `Impressum — ${imprint.value.organizationName}` : 'Impressum')) })
</script>

<template>
  <div class="text-left">
    <template v-if="status === 'loading'">
      <div class="text-center">
        <LoaderCircle :size="24" class="mx-auto mb-3 animate-spin text-forest" />
        <p class="text-sm text-[#6c756f]">Impressum wird geladen …</p>
      </div>
    </template>

    <template v-else-if="status === 'not-found'">
      <div class="text-center">
        <AlertTriangle :size="24" class="mx-auto mb-3 text-amber-700" />
        <h1 class="font-display text-xl font-extrabold tracking-[-.03em]">Verein nicht gefunden</h1>
        <p class="mt-2 text-sm text-amber-800">Für diesen Link ist kein Verein hinterlegt.</p>
      </div>
    </template>

    <template v-else-if="status === 'error'">
      <div class="text-center">
        <AlertTriangle :size="24" class="mx-auto mb-3 text-amber-700" />
        <h1 class="font-display text-xl font-extrabold tracking-[-.03em]">Etwas ist schiefgelaufen</h1>
        <p class="mt-2 text-sm text-amber-800">Bitte versuche es später erneut.</p>
      </div>
    </template>

    <template v-else-if="imprint">
      <h1 class="font-display text-xl font-extrabold tracking-[-.03em]">Impressum — {{ imprint.organizationName }}</h1>

      <section class="mt-5">
        <h2 class="text-sm font-bold text-ink">Angaben gemäß § 5 TMG</h2>
        <p class="mt-2 text-sm text-[#43483f]">
          {{ orNotProvided(imprint.legalName) }}<br />
          {{ imprint.legalForm ? LEGAL_FORM_LABELS[imprint.legalForm] : 'nicht angegeben' }}<br />
          <template v-if="imprint.street || imprint.houseNumber">{{ orNotProvided(imprint.street) }} {{ imprint.houseNumber ?? '' }}<br /></template>
          <template v-else>nicht angegeben<br /></template>
          <template v-if="imprint.postalCode || imprint.city">{{ orNotProvided(imprint.postalCode) }} {{ imprint.city ?? '' }}<br /></template>
          <template v-else>nicht angegeben<br /></template>
          {{ imprint.countryCode }}
        </p>
        <p class="mt-3 text-sm text-[#43483f]">Registergericht/-nummer: {{ orNotProvided(imprint.registerCourt) }}<template v-if="imprint.registerNumber"> · {{ imprint.registerNumber }}</template></p>
      </section>

      <section class="mt-5">
        <h2 class="text-sm font-bold text-ink">Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV</h2>
        <p class="mt-2 text-sm text-[#43483f]">{{ orNotProvided(imprint.responsiblePersonName) }}</p>
      </section>

      <section class="mt-5">
        <h2 class="text-sm font-bold text-ink">Kontakt</h2>
        <p class="mt-2 text-sm text-[#43483f]">
          E-Mail: {{ orNotProvided(imprint.contactEmail) }}<br />
          Telefon: {{ orNotProvided(imprint.contactPhone) }}<br />
          Website: <template v-if="imprint.websiteUrl"><a :href="imprint.websiteUrl" class="font-semibold text-forest" rel="noopener">{{ imprint.websiteUrl }}</a></template><template v-else>nicht angegeben</template>
        </p>
      </section>

      <p class="mt-6 text-xs text-[#9aa096]">Bereitgestellt über Vereinsfunk. Für die Angaben ist der Verein selbst verantwortlich.</p>
    </template>
  </div>
</template>
