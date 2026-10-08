<script setup lang="ts">
import { AlertTriangle, Camera, Goal, LoaderCircle, Trophy } from '@lucide/vue'
import {
  PublicPlayerboardPhotoSchema,
  PublicPlayerboardRankingEntrySchema,
  PublicPlayerboardTeamSchema,
  PublicPlayerboardVeoMatchSchema,
  type PublicPlayerboardPhoto,
  type PublicPlayerboardTeam,
  type PublicPlayerboardVeoMatch,
} from '@vereinsfunk/contracts'
import type { VeoCardMatch } from '../../../components/PlayerboardVeoMatchCard.vue'
import type { VeoSeasonMatch } from '../../../components/PlayerboardVeoSeason.vue'
import { scoreLabel } from '../../../utils/playerboardVeo'
import type { RankingListItem } from '../../../utils/playerboardRanking'
import { PublicTeamRouteParamsSchema } from '../../../utils/publicTeamPage'
import { deriveSidebarPalette } from '../../../utils/sidebarBrand'

// Paket 052, PR 4: oeffentliche Mannschaftsseite ohne Anmeldung (Muster oeffentliches Impressum,
// Paket 020). Spieler erscheinen nur als "#7 M. K." -- die Bezeichnung bildet die Datenbank, die
// Seite bekommt nie Namen. Fotos nur nach bestandener Einzelbild-Pruefung, als kurzlebige Links.
// Anders als das Impressum mit noindex: in Jugendmannschaften sind die Spieler Kinder.
definePageMeta({ layout: 'auth' })

const route = useRoute()
const config = useRuntimeConfig()
const routeParams = PublicTeamRouteParamsSchema.safeParse({
  orgSlug: route.params.orgSlug,
  teamSlug: route.params.teamSlug,
})
const orgSlug = routeParams.success ? routeParams.data.orgSlug : ''
const teamSlug = routeParams.success ? routeParams.data.teamSlug : ''
const basePath = routeParams.success
  ? `${config.public.apiBase}/v1/public/playerboard/${orgSlug}/${teamSlug}`
  : ''

const {
  data: team,
  error,
  pending,
} = await useAsyncData<PublicPlayerboardTeam>(`public-team-${orgSlug}-${teamSlug}`, async () => {
  if (!routeParams.success) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  const response = await $fetch(basePath)
  return PublicPlayerboardTeamSchema.parse(response)
})

type PublicTab = 'ranking' | 'veo' | 'photos'
const tabItems = computed(() => {
  if (!team.value) return []
  return [
    { key: 'ranking' as const, label: 'Rangliste', icon: Trophy, enabled: team.value.tabs.points },
    { key: 'veo' as const, label: 'Spiele', icon: Goal, enabled: team.value.tabs.veoStats },
    { key: 'photos' as const, label: 'Fotos', icon: Camera, enabled: team.value.tabs.photos },
  ].filter((item) => item.enabled)
})
const tab = ref<PublicTab>('ranking')
watch(
  tabItems,
  (items) => {
    if (items.length && !items.some((item) => item.key === tab.value)) tab.value = items[0]!.key
  },
  { immediate: true },
)

const {
  data: ranking,
  pending: rankingPending,
  error: rankingError,
} = await useAsyncData<RankingListItem[]>(
  `public-team-ranking-${orgSlug}-${teamSlug}`,
  async () => {
    if (!team.value?.tabs.points) return []
    const response = await $fetch(`${basePath}/ranking`, {
      query: team.value.seasonFrom ? { from: team.value.seasonFrom } : {},
    })
    return PublicPlayerboardRankingEntrySchema.array()
      .parse(response)
      .map((entry, index) => ({
        key: `${index}`,
        rank: entry.rank,
        label: entry.label,
        total: entry.total,
        categories: entry.categories.map((category) => ({
          name: category.category,
          points: category.points,
        })),
      }))
  },
  { watch: [team] },
)

// Spiele mit Veo-Werten der Saison, beim ersten Oeffnen des Reiters geladen.
const veoMatches = ref<PublicPlayerboardVeoMatch[] | null>(null)
const veoError = ref(false)
const veoSelected = ref(0)
/** Laedt die oeffentlichen Spiele der laufenden Saison. */
async function loadVeo() {
  if (veoMatches.value) return
  veoError.value = false
  try {
    veoMatches.value = PublicPlayerboardVeoMatchSchema.array().parse(await $fetch(`${basePath}/veo`, {
      query: team.value?.seasonFrom ? { from: team.value.seasonFrom } : {},
    }))
  } catch {
    veoError.value = true
  }
}
const veoSeasonMatches = computed<VeoSeasonMatch[]>(() => (veoMatches.value ?? []).map((match) => ({
  ownScore: match.ownScore,
  opponentScore: match.opponentScore,
  teamStats: match.teamStats,
  players: match.players.map((player) => ({ key: player.label, label: player.label, jerseyNumber: player.jerseyNumber, stats: player.stats })),
})))
const veoSelectedMatch = computed<VeoCardMatch | null>(() => veoMatches.value?.[veoSelected.value] ?? null)
const veoDate = computed(() => new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: team.value?.timezone ?? 'Europe/Berlin' }))

// Fotos erst beim Oeffnen des Reiters: die signierten Links leben nur fuenf Minuten.
const photos = ref<PublicPlayerboardPhoto[] | null>(null)
const photosError = ref(false)
// Vollbild mit Wischen durch alle freigegebenen Fotos.
const photoGallery = ref<HTMLElement | null>(null)
usePhotoSwipe(photoGallery)
/** Laedt die freigegebenen Fotos mit frischen, kurzlebigen Links. */
async function loadPhotos() {
  photosError.value = false
  try {
    photos.value = PublicPlayerboardPhotoSchema.array().parse(await $fetch(`${basePath}/photos`))
  } catch {
    photosError.value = true
  }
}
watch(
  tab,
  (value) => {
    if (value === 'photos' && import.meta.client) void loadPhotos()
    if (value === 'veo' && import.meta.client) void loadVeo()
  },
  { immediate: true },
)

const status = computed<'loading' | 'ready' | 'not-found' | 'error'>(() => {
  if (pending.value) return 'loading'
  // Nur ein 404 heisst "keine oeffentliche Seite"; Transportfehler oder 429 sind etwas anderes.
  if (error.value)
    return (error.value as { statusCode?: number })?.statusCode === 404 ? 'not-found' : 'error'
  return team.value ? 'ready' : 'error'
})
const palette = computed(() =>
  deriveSidebarPalette(
    team.value?.brand.primaryColor ?? '#163a2c',
    team.value?.brand.accentColor ?? '#caff4a',
  ),
)
const dateFormat = new Intl.DateTimeFormat('de-DE', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})
/** Formatiert ein Datum YYYY-MM-DD ohne Zeitzonenverschiebung. */
function formatDate(value: string): string {
  return dateFormat.format(new Date(`${value}T00:00:00Z`))
}

useHead({
  title: computed(() =>
    team.value ? `${team.value.teamName} — ${team.value.organizationName}` : 'Mannschaft',
  ),
  meta: [{ name: 'robots', content: 'noindex, nofollow' }],
})
</script>

<template>
  <div class="text-left">
    <div v-if="status === 'loading'" class="text-center">
      <LoaderCircle :size="24" class="mx-auto mb-3 animate-spin text-forest" />
      <p class="text-sm text-[#6c756f]">Wird geladen …</p>
    </div>

    <div v-else-if="status === 'not-found'" class="text-center">
      <AlertTriangle :size="24" class="mx-auto mb-3 text-amber-700" />
      <h1 class="font-display text-xl font-extrabold tracking-[-.03em]">Seite nicht gefunden</h1>
      <p class="mt-2 text-sm text-[#6c756f]">
        Unter dieser Adresse gibt es keine öffentliche Mannschaftsseite.
      </p>
    </div>

    <div v-else-if="status === 'error' || !team" class="text-center">
      <AlertTriangle :size="24" class="mx-auto mb-3 text-amber-700" />
      <p class="text-sm text-amber-800">
        Die Seite konnte gerade nicht geladen werden. Bitte versuche es später noch einmal.
      </p>
    </div>

    <template v-else>
      <header
        class="-mx-6 -mt-6 mb-5 rounded-t-[inherit] px-6 pb-5 pt-6 sm:-mx-8 sm:-mt-8 sm:px-8"
        :style="{ backgroundColor: palette.surface, color: palette.onSurface }"
      >
        <p class="text-[11px] font-bold uppercase tracking-[.12em] opacity-80">
          {{ team.organizationName }}
        </p>
        <h1 class="mt-1 font-display text-2xl font-extrabold tracking-[-.03em]">
          {{ team.teamName }}
        </h1>
      </header>

      <div
        v-if="tabItems.length > 1"
        class="mb-4 flex gap-2"
        role="tablist"
        aria-label="Inhalt"
      >
        <button
          v-for="item in tabItems"
          :id="`public-team-tab-${item.key}`"
          :key="item.key"
          type="button"
          role="tab"
          :aria-selected="tab === item.key"
          :aria-controls="`public-team-panel-${item.key}`"
          class="focus-ring inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border text-xs font-semibold"
          :class="tab === item.key ? 'border-transparent' : 'border-[#dfe0d9] bg-white text-ink'"
          :style="
            tab === item.key
              ? { backgroundColor: palette.actionSurface, color: palette.onAction }
              : undefined
          "
          @click="tab = item.key"
        >
          <component :is="item.icon" :size="15" /> {{ item.label }}
        </button>
      </div>

      <section
        v-if="tab === 'ranking' && team.tabs.points"
        id="public-team-panel-ranking"
        role="tabpanel"
        aria-labelledby="public-team-tab-ranking"
      >
        <p class="mb-3 text-xs text-[#6c756f]">
          {{ team.seasonFrom ? `Saison seit ${formatDate(team.seasonFrom)}` : 'Gesamte Zeit' }} ·
          Trainingspunkte
        </p>
        <p v-if="rankingPending" class="text-xs text-[#7b827d]">Wird geladen …</p>
        <p v-else-if="rankingError" class="text-sm text-amber-800">
          Die Rangliste konnte nicht geladen werden.
        </p>
        <PlayerboardRankingList
          v-else
          :items="ranking ?? []"
          empty-text="In dieser Saison gibt es noch keine Punkte."
        />
      </section>

      <section
        v-if="tab === 'veo' && team.tabs.veoStats"
        id="public-team-panel-veo"
        role="tabpanel"
        aria-labelledby="public-team-tab-veo"
        class="space-y-5"
      >
        <p class="text-xs text-[#6c756f]">
          {{ team.seasonFrom ? `Saison seit ${formatDate(team.seasonFrom)}` : 'Gesamte Zeit' }} · Werte aus der Veo-Kamera
        </p>
        <p v-if="veoError" class="text-sm text-amber-800">Die Spiele konnten nicht geladen werden.</p>
        <p v-else-if="veoMatches === null" class="text-xs text-[#7b827d]">Wird geladen …</p>
        <p v-else-if="veoMatches.length === 0" class="text-sm text-[#6c756f]">In dieser Saison gibt es noch keine Spiele mit Veo-Werten.</p>
        <template v-else>
          <PlayerboardVeoSeason :matches="veoSeasonMatches" />
          <label class="grid min-w-0 gap-1 text-xs font-semibold text-[#5b625d]">
            Spiel
            <!-- min-w-0: ein Auswahlfeld ist sonst so breit wie sein laengster Eintrag und schiebt die Seite auf. -->
            <select v-model="veoSelected" class="focus-ring h-11 w-full min-w-0 rounded-xl border border-[#dfe0d9] bg-white px-3 text-sm text-ink">
              <option v-for="(match, index) in veoMatches" :key="index" :value="index">
                {{ veoDate.format(new Date(match.kickoffAt)) }} · {{ match.opponentName ?? 'unbekannt' }} · {{ scoreLabel(match) }}
              </option>
            </select>
          </label>
          <PlayerboardVeoMatchCard v-if="veoSelectedMatch" :match="veoSelectedMatch" :timezone="team.timezone" />
        </template>
      </section>

      <section
        v-if="tab === 'photos' && team.tabs.photos"
        id="public-team-panel-photos"
        role="tabpanel"
        aria-labelledby="public-team-tab-photos"
      >
        <p v-if="photosError" class="text-sm text-amber-800">
          Die Fotos konnten nicht geladen werden.
        </p>
        <p v-else-if="photos === null" class="text-xs text-[#7b827d]">Wird geladen …</p>
        <p v-else-if="photos.length === 0" class="text-sm text-[#6c756f]">Noch keine Fotos.</p>
        <ul v-else ref="photoGallery" class="grid grid-cols-2 gap-2">
          <li
            v-for="photo in photos"
            :key="photo.url"
            class="overflow-hidden rounded-xl bg-[#eef1ea]"
          >
            <a :href="photo.url" data-pswp class="focus-ring block" :aria-label="`Trainingsfoto vom ${formatDate(photo.trainingDate)} groß anzeigen`">
              <img
                :src="photo.url"
                :alt="`Trainingsfoto vom ${formatDate(photo.trainingDate)}`"
                class="aspect-square w-full object-cover"
                loading="lazy"
              />
            </a>
            <p class="px-2 py-1 text-[10px] text-[#6c756f]">{{ formatDate(photo.trainingDate) }}</p>
          </li>
        </ul>
      </section>

      <p v-if="tabItems.length === 0" class="text-sm text-[#6c756f]">
        Diese Mannschaft zeigt gerade nichts öffentlich.
      </p>
    </template>
  </div>
</template>
