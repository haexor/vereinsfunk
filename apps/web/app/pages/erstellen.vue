<script setup lang="ts">
import { ArrowLeft, ArrowRight, CalendarDays, Check, ImagePlus, LoaderCircle, MapPin, Sparkles, UploadCloud, Users, X } from '@lucide/vue'
import type { ContentType, GeneratedPost } from '@vereinsfunk/contracts'

const config = useRuntimeConfig()
const step = ref(1)
const loading = ref(false)
const apiNotice = ref('')
const selectedType = ref<ContentType>('match_result')
const form = reactive({ title: '', opponent: 'TSV Südstadt', date: '2026-08-08', location: 'Sportplatz Nord', homeScore: '3', awayScore: '1', audience: '', contact: '' })
const preview = ref<GeneratedPost | null>(null)
const types: { id: ContentType; label: string; description: string; icon: typeof Users; color: string }[] = [
  { id: 'match_result', label: 'Spielergebnis', description: 'Ergebnis, Highlights und Dank', icon: Check, color: '#caff4a' },
  { id: 'match_announcement', label: 'Spielankündigung', description: 'Termin, Gegner und Spielort', icon: CalendarDays, color: '#9fddff' },
  { id: 'member_recruitment', label: 'Mitglieder gesucht', description: 'Neue Menschen fürs Team gewinnen', icon: Users, color: '#ffd1c7' },
  { id: 'event', label: 'Veranstaltung', description: 'Turnier, Fest oder Vereinsabend', icon: MapPin, color: '#d9caff' },
]

const factRecord = (...entries: readonly (readonly [string, string])[]): Record<string, string> =>
  Object.fromEntries(entries)

const facts = computed<Record<string, string>>(() => {
  if (selectedType.value === 'match_result') return factRecord(['homeTeam', 'SV Nordstadt'], ['awayTeam', form.opponent], ['homeScore', form.homeScore], ['awayScore', form.awayScore])
  if (selectedType.value === 'match_announcement') return factRecord(['opponent', form.opponent], ['date', form.date], ['location', form.location])
  if (selectedType.value === 'member_recruitment') return factRecord(['audience', form.audience], ['contact', form.contact])
  return factRecord(['title', form.title || 'Sommerfest im Vereinsheim'], ['date', form.date], ['location', form.location])
})

const createPreview = async () => {
  loading.value = true
  apiNotice.value = ''
  try {
    const response = await $fetch<{ preview: GeneratedPost }>(`${config.public.apiBase}/v1/submissions`, {
      method: 'POST',
      body: {
        organizationId: '11111111-1111-4111-8111-111111111111',
        departmentId: '22222222-2222-4222-8222-222222222222',
        contentType: selectedType.value,
        facts: facts.value,
      },
    })
    preview.value = response.preview
  } catch {
    const verifiedFacts = Object.entries(facts.value).filter(([, value]) => value).map(([key, value]) => `${key}: ${value}`)
    preview.value = {
      verifiedFacts,
      missingFacts: [],
      headline: selectedType.value === 'match_result' ? 'Drei Punkte. Ein Team.' : form.title || 'Gemeinsam wird’s besonders.',
      caption: `Was für ein Tag für unseren Verein! 💚\n\n${verifiedFacts.map((item) => `• ${item}`).join('\n')}\n\nDanke an alle, die dabei waren und uns unterstützt haben. Gemeinsam sind wir Vereinsfunk.`,
      shortCaption: 'Gemeinsam stark – auf und neben dem Platz.',
      callToAction: 'Teile den Beitrag mit deinem Team.',
      hashtags: ['#vereinsleben', '#gemeinsamstark', '#svnorthstadt'],
      altText: 'Vereinsgrafik mit dem aktuellen Beitragstitel.',
      templateId: `${selectedType.value}-v1`,
      safetyFlags: [],
    }
    apiNotice.value = 'Lokale Vorschau – starte die API für den vollständigen Workflow.'
  } finally {
    loading.value = false
    step.value = 3
  }
}
</script>

<template>
  <div class="min-h-screen bg-[#f6f4ec]">
    <div class="mx-auto max-w-[1160px] px-5 py-7 sm:px-8 lg:py-10">
      <header class="mb-8 flex items-center justify-between">
        <NuxtLink to="/" class="focus-ring flex items-center gap-2 rounded-lg text-xs font-semibold text-[#69716c] hover:text-ink"><ArrowLeft :size="15" /> Zur Übersicht</NuxtLink>
        <div class="hidden items-center gap-2 sm:flex"><template v-for="n in 3" :key="n"><span class="grid h-7 w-7 place-items-center rounded-full text-[11px] font-bold" :class="step >= n ? 'bg-forest text-white' : 'bg-[#e2e3dc] text-[#8a908c]'">{{ step > n ? '✓' : n }}</span><span v-if="n < 3" class="h-px w-10" :class="step > n ? 'bg-forest' : 'bg-[#d8d9d2]'" /></template></div>
        <button class="focus-ring rounded-lg p-2 text-[#737a75]" aria-label="Abbrechen" @click="navigateTo('/')"><X :size="18" /></button>
      </header>

      <div v-if="step < 3" class="mx-auto max-w-[820px]">
        <div class="mb-8 text-center"><div class="eyebrow mb-3">Schritt {{ step }} von 3</div><h1 class="font-display text-3xl font-extrabold tracking-[-.045em] sm:text-4xl">{{ step === 1 ? 'Was gibt es zu erzählen?' : 'Gib uns die sicheren Fakten.' }}</h1><p class="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-[#717973]">{{ step === 1 ? 'Wähle den passenden Anlass. Wir passen Struktur, Ton und Format automatisch an.' : 'Die KI formuliert – du lieferst und bestätigst die Fakten.' }}</p></div>

        <div v-if="step === 1" class="grid gap-3 sm:grid-cols-2">
          <button v-for="type in types" :key="type.id" class="focus-ring group flex items-center gap-4 rounded-2xl border bg-white p-5 text-left transition hover:-translate-y-0.5 hover:shadow-md" :class="selectedType === type.id ? 'border-forest ring-2 ring-forest/10' : 'border-[#e0e1da]'" @click="selectedType = type.id">
            <span class="grid h-12 w-12 shrink-0 place-items-center rounded-xl text-ink" :style="{ background: type.color }"><component :is="type.icon" :size="20" /></span><span class="flex-1"><span class="block font-display text-sm font-bold">{{ type.label }}</span><span class="mt-1 block text-[11px] text-[#7a817c]">{{ type.description }}</span></span><span class="grid h-5 w-5 place-items-center rounded-full border" :class="selectedType === type.id ? 'border-forest bg-forest text-white' : 'border-[#ccd0ca]'"> <Check v-if="selectedType === type.id" :size="12" /></span>
          </button>
        </div>

        <div v-else class="card p-5 sm:p-7">
          <div class="grid gap-5 sm:grid-cols-2">
            <label v-if="selectedType === 'event'" class="sm:col-span-2"><span class="mb-2 block text-xs font-semibold">Name der Veranstaltung</span><input v-model="form.title" class="focus-ring w-full rounded-xl border border-[#dfe0d9] bg-white px-4 py-3 text-sm" placeholder="z. B. Sommerfest im Vereinsheim" /></label>
            <label v-if="selectedType === 'match_result' || selectedType === 'match_announcement'"><span class="mb-2 block text-xs font-semibold">Gegner</span><input v-model="form.opponent" class="focus-ring w-full rounded-xl border border-[#dfe0d9] bg-white px-4 py-3 text-sm" /></label>
            <template v-if="selectedType === 'match_result'"><label><span class="mb-2 block text-xs font-semibold">Unser Ergebnis</span><input v-model="form.homeScore" type="number" min="0" class="focus-ring w-full rounded-xl border border-[#dfe0d9] bg-white px-4 py-3 text-sm" /></label><label><span class="mb-2 block text-xs font-semibold">Gegnerisches Ergebnis</span><input v-model="form.awayScore" type="number" min="0" class="focus-ring w-full rounded-xl border border-[#dfe0d9] bg-white px-4 py-3 text-sm" /></label></template>
            <template v-if="selectedType === 'member_recruitment'"><label><span class="mb-2 block text-xs font-semibold">Wen sucht ihr?</span><input v-model="form.audience" class="focus-ring w-full rounded-xl border border-[#dfe0d9] bg-white px-4 py-3 text-sm" placeholder="z. B. Kinder Jahrgang 2015" /></label><label><span class="mb-2 block text-xs font-semibold">Kontakt</span><input v-model="form.contact" class="focus-ring w-full rounded-xl border border-[#dfe0d9] bg-white px-4 py-3 text-sm" placeholder="sport@verein.de" /></label></template>
            <template v-if="selectedType !== 'match_result' && selectedType !== 'member_recruitment'"><label><span class="mb-2 block text-xs font-semibold">Datum</span><input v-model="form.date" type="date" class="focus-ring w-full rounded-xl border border-[#dfe0d9] bg-white px-4 py-3 text-sm" /></label><label><span class="mb-2 block text-xs font-semibold">Ort</span><input v-model="form.location" class="focus-ring w-full rounded-xl border border-[#dfe0d9] bg-white px-4 py-3 text-sm" /></label></template>
            <label class="sm:col-span-2"><span class="mb-2 block text-xs font-semibold">Bilder oder Videos <span class="font-normal text-[#858b87]">(optional)</span></span><span class="focus-ring flex cursor-pointer flex-col items-center rounded-2xl border border-dashed border-[#cfd2cb] bg-[#fafaf7] px-6 py-8 text-center transition hover:border-forest hover:bg-white"><input type="file" class="sr-only" accept="image/*,video/*" multiple /><UploadCloud :size="24" class="mb-2 text-forest" /><span class="text-xs font-semibold">Dateien hier ablegen oder auswählen</span><span class="mt-1 text-[10px] text-[#898f8a]">JPG, PNG oder MP4 · private Ablage</span></span></label>
          </div>
          <div class="mt-5 flex items-start gap-3 rounded-xl bg-[#eff4e6] p-3 text-[11px] leading-relaxed text-[#5d685d]"><ImagePlus :size="16" class="mt-0.5 shrink-0 text-forest" /><span>Aufnahmen mit Minderjährigen werden vor einer Freigabe gesondert geprüft. Bitte stelle sicher, dass eine gültige Einwilligung vorliegt.</span></div>
        </div>

        <div class="mt-7 flex justify-between"><button v-if="step === 2" class="focus-ring flex items-center gap-2 rounded-xl border border-[#dadcd4] bg-white px-5 py-3 text-xs font-semibold" @click="step = 1"><ArrowLeft :size="14" /> Zurück</button><span v-else /><button v-if="step === 1" class="focus-ring flex items-center gap-2 rounded-xl bg-forest px-6 py-3 text-xs font-bold text-white" @click="step = 2">Weiter <ArrowRight :size="14" /></button><button v-else class="focus-ring flex items-center gap-2 rounded-xl bg-forest px-6 py-3 text-xs font-bold text-white disabled:opacity-60" :disabled="loading" @click="createPreview"><LoaderCircle v-if="loading" :size="15" class="animate-spin" /><Sparkles v-else :size="15" /> {{ loading ? 'Entwurf entsteht …' : 'Entwurf erstellen' }}</button></div>
      </div>

      <div v-else-if="preview" class="mx-auto max-w-[1040px]">
        <div class="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><div class="eyebrow mb-3">Entwurf bereit</div><h1 class="font-display text-3xl font-extrabold tracking-[-.045em]">Euer Beitrag nimmt Form an.</h1><p class="mt-2 text-sm text-[#717973]">Prüfe Text und Gestaltung, bevor du ihn zur Freigabe gibst.</p></div><span v-if="apiNotice" class="rounded-full bg-amber-100 px-3 py-1.5 text-[10px] font-semibold text-amber-800">{{ apiNotice }}</span></div>
        <div class="grid gap-6 lg:grid-cols-[.85fr_1.15fr]">
          <div class="relative mx-auto aspect-[4/5] w-full max-w-[420px] overflow-hidden rounded-[24px] bg-forest p-8 text-white shadow-xl"><div class="absolute -right-24 -top-24 h-80 w-80 rounded-full bg-lime" /><div class="absolute right-12 top-12 h-20 w-20 rounded-full border-[16px] border-forest/15" /><div class="relative flex h-full flex-col"><span class="eyebrow !text-white/55">SV Nordstadt · Fußball</span><h2 class="mt-auto max-w-[90%] font-display text-4xl font-extrabold leading-[.95] tracking-[-.06em] sm:text-5xl">{{ preview.headline }}</h2><div class="mt-6 flex items-end justify-between border-t border-white/20 pt-5 text-[11px] font-semibold"><span>#gemeinsamstark</span><span>SN</span></div></div></div>
          <div class="card p-5 sm:p-7"><div class="mb-5 flex items-center justify-between"><div><div class="eyebrow mb-2">Instagram & Facebook</div><h2 class="font-display text-base font-bold">Beitragstext</h2></div><div class="flex gap-1"><PlatformIcon platform="instagram" /><PlatformIcon platform="facebook" /></div></div><textarea v-model="preview.caption" rows="11" class="focus-ring w-full resize-none rounded-xl border border-[#dfe0d9] bg-white p-4 text-sm leading-relaxed" /><div class="mt-3 flex flex-wrap gap-1.5"><span v-for="tag in preview.hashtags" :key="tag" class="rounded-full bg-[#eef1e9] px-2.5 py-1 text-[10px] font-semibold text-forest">{{ tag }}</span></div><div class="mt-5 rounded-xl bg-emerald-50 p-3 text-[11px] text-emerald-800"><strong>Faktencheck:</strong> {{ preview.verifiedFacts.length }} Angaben übernommen · {{ preview.missingFacts.length }} offen</div><div class="mt-6 flex flex-col gap-2 sm:flex-row"><button class="focus-ring flex-1 rounded-xl border border-[#dfe0d9] px-4 py-3 text-xs font-semibold" @click="step = 2">Daten bearbeiten</button><button class="focus-ring flex flex-1 items-center justify-center gap-2 rounded-xl bg-forest px-4 py-3 text-xs font-bold text-white" @click="navigateTo('/freigaben')"><Check :size="14" /> Zur Freigabe geben</button></div></div>
        </div>
      </div>
    </div>
  </div>
</template>
