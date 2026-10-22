<script setup lang="ts">
// Spec 002: Spielfeld in drei Drittel aus Sicht der Mannschaft, je Drittel der Anteil in ganzen
// Prozent; das staerkste Drittel am kraeftigsten (Inventar §1a.4, §1b.5). Die Rangstufe steht auch
// im Textersatz (FR-067).
const props = defineProps<{ percents: Readonly<Record<'defensive' | 'middle' | 'attacking', number>>; label: string }>()

const THIRDS = [
  { key: 'defensive', label: 'Verteidigung' },
  { key: 'middle', label: 'Mitte' },
  { key: 'attacking', label: 'Angriff' },
] as const
const RANK_FILL = ['rgba(255,213,74,.75)', 'rgba(255,213,74,.45)', 'rgba(255,213,74,.2)']

const zones = computed(() => {
  const ranked = [...THIRDS].sort((a, b) => props.percents[b.key] - props.percents[a.key])
  return THIRDS.map((third, index) => ({ ...third, index, percent: props.percents[third.key], rank: ranked.findIndex((entry) => entry.key === third.key) }))
})
const description = computed(() => `${props.label}: ${zones.value.map((zone) => `${zone.label} ${zone.percent} %`).join(', ')}`)
</script>

<template>
  <div>
    <PlayerboardPitch :label="description" thirds>
      <template #default>
        <g v-for="zone in zones" :key="zone.key">
          <rect :x="zone.index * 78" y="0" width="78" height="150" :fill="RANK_FILL[zone.rank]" />
          <circle :cx="zone.index * 78 + 39" cy="75" r="17" fill="#ffffff" />
          <text :x="zone.index * 78 + 39" y="80" text-anchor="middle" font-size="13" font-weight="700" fill="#163a2c">{{ zone.percent }}%</text>
        </g>
      </template>
    </PlayerboardPitch>
    <div class="mt-1 grid grid-cols-3 text-center text-[11px] font-semibold text-[#5b625d]" aria-hidden="true">
      <span v-for="zone in zones" :key="zone.key">{{ zone.label }}</span>
    </div>
  </div>
</template>
