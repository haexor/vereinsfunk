<script setup lang="ts">
import { playerRowName, playerRowSubtitle, type VeoPlayerRow } from '../utils/playerboardVeoPlayers'

// Spec 002, PR 5: Spielerliste neben Schusskarte und Heatmap wie Veo (Inventar §2.1.3, §2.1.4):
// ein Spieler ist gewaehlt, rechts steht seine Zahl (etwa Abschluesse).
const props = defineProps<{ rows: readonly (Pick<VeoPlayerRow, 'key' | 'name' | 'jerseyNumber' | 'position'> & { score?: number })[]; label: string }>()
const selected = defineModel<string | null>({ required: true })
</script>

<template>
  <!-- Ab md bestimmt die Karte die Zeilenhoehe; die Liste fuellt sie aus und scrollt darin. -->
  <div class="relative md:min-h-64">
    <ul class="grid max-h-80 content-start gap-1 overflow-y-auto pr-1 md:absolute md:inset-0 md:max-h-none" :aria-label="props.label">
      <li v-for="row in rows" :key="row.key">
        <button
          type="button" class="focus-ring flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border px-3 py-1 text-left text-sm"
          :class="selected === row.key ? 'border-forest bg-[#e4f1e7] text-forest' : 'border-[#e8e9e2] bg-white text-ink'" :aria-pressed="selected === row.key"
          @click="selected = row.key"
        >
          <span class="min-w-0">
            <span class="block truncate font-semibold">{{ playerRowName(row) }}</span>
            <span v-if="playerRowSubtitle(row)" class="block text-[11px] text-[#6c756f]">{{ playerRowSubtitle(row) }}</span>
          </span>
          <span v-if="row.score !== undefined" class="font-display text-lg font-extrabold tabular-nums">{{ row.score }}</span>
        </button>
      </li>
    </ul>
  </div>
</template>
