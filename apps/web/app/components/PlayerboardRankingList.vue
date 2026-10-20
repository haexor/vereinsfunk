<script setup lang="ts">
import { ChevronDown } from '@lucide/vue'
import { placementBadgeClass, placementRowClass, type RankingListItem } from '../utils/playerboardRanking'

// Paket 052, PR 4: Rangliste als Liste, die auf 360 px ohne seitliches Scrollen auskommt. Intern
// mit Namen, oeffentlich nur mit "#7 M. K." -- die Seiten bilden ihre Eintraege auf diese Form ab.
// Die Punkte je Kategorie klappen pro Zeile auf, statt Spalten zu brauchen. compact ist die schmale
// Fassung fuer die Saison-Kachel (PlayerboardSeasonSummary.vue): ohne Karte und ohne Aufklappen.

defineProps<{ items: readonly RankingListItem[]; emptyText: string; compact?: boolean }>()
const expanded = ref<string | null>(null)

/** Klappt die Kategorien einer Zeile auf oder zu. */
function toggle(key: string) {
  expanded.value = expanded.value === key ? null : key
}
</script>

<template>
  <p v-if="items.length === 0" :class="compact ? 'text-sm text-[#6c756f]' : 'card p-6 text-center text-sm text-[#6c756f]'">{{ emptyText }}</p>
  <ol v-else-if="compact" class="-mx-2 space-y-0.5">
    <li v-for="item in items" :key="item.key" class="flex items-center gap-2 rounded-lg px-2 py-1" :class="placementRowClass(item.rank)">
      <span class="grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-extrabold" :class="placementBadgeClass(item.rank)">{{ item.rank }}</span>
      <span class="min-w-0 flex-1 truncate text-sm" :class="item.highlight ? 'font-bold text-forest' : 'text-ink'"><PersonLink :person-id="item.personId">{{ item.label }}</PersonLink></span>
      <span class="text-sm font-bold tabular-nums text-ink">{{ item.total }}</span>
    </li>
  </ol>
  <ol v-else class="card divide-y divide-[#ecece5]" data-testid="ranking-list">
    <!-- Plaetze 1 bis 3 in ihrer Medaillenfarbe; die eigene Zeile zusaetzlich mit Balken links, damit
         sich beide Hervorhebungen nicht ueberdecken. -->
    <li
      v-for="item in items"
      :key="item.key"
      class="first:rounded-t-[inherit] last:rounded-b-[inherit]"
      :class="[placementRowClass(item.rank), item.highlight ? 'shadow-[inset_4px_0_0_var(--color-forest)]' : '']"
    >
      <!-- Ein Link darf nicht in einem Button stehen: der Aufklapp-Button liegt als Flaeche hinter der
           Zeile (die ganze Zeile bleibt Klickziel), nur der Namenslink liegt darueber. -->
      <div class="relative flex min-h-14 w-full items-center gap-3 px-3 py-2 sm:px-4">
        <button
          type="button"
          class="focus-ring absolute inset-0 rounded-[inherit]"
          :aria-expanded="expanded === item.key"
          :aria-label="`Punkte je Kategorie von ${item.label}`"
          :disabled="item.categories.length === 0"
          @click="toggle(item.key)"
        />
        <span class="pointer-events-none relative grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-extrabold" :class="placementBadgeClass(item.rank)" :aria-label="`Platz ${item.rank}`">{{ item.rank }}</span>
        <span class="pointer-events-none relative min-w-0 flex-1 truncate text-sm font-semibold text-ink">
          <PersonLink :person-id="item.personId" :class="item.personId ? 'pointer-events-auto' : undefined">{{ item.label }}</PersonLink><span v-if="item.highlight" class="ml-2 rounded-full bg-forest px-2 py-0.5 text-[10px] font-bold text-white">Du</span>
        </span>
        <span class="pointer-events-none relative shrink-0 font-display text-lg font-extrabold tabular-nums text-ink">{{ item.total }}</span>
        <ChevronDown v-if="item.categories.length > 0" :size="16" class="pointer-events-none relative shrink-0 text-[#9aa096] transition" :class="expanded === item.key ? 'rotate-180' : ''" aria-hidden="true" />
      </div>
      <dl v-if="expanded === item.key" class="grid grid-cols-2 gap-x-4 gap-y-1 px-4 pb-3 pl-15 text-xs sm:grid-cols-3">
        <div v-for="category in item.categories" :key="category.name" class="flex justify-between gap-2">
          <dt class="truncate text-[#6c756f]">{{ category.name }}</dt>
          <dd class="font-semibold tabular-nums text-ink">{{ category.points }}</dd>
        </div>
      </dl>
    </li>
  </ol>
</template>
