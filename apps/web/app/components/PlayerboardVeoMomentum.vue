<script setup lang="ts">
import type { PlayerboardVeoMatchAnalysis } from '@vereinsfunk/contracts'
import { momentumSeries } from '@vereinsfunk/domain'

// Spec 002, PR 2: Spielverlauf (Inventar §1a.11). Nach oben: Geschehen am gegnerischen Ende der
// Heimmannschaft, nach unten: der Gastmannschaft. Luecken ausserhalb der Halbzeiten, geglaettet
// mit Catmull-Rom statt d3. Daneben der Anteil der Aktionen je Seite.
const props = defineProps<{
  analysis: Pick<PlayerboardVeoMatchAnalysis, 'momentum' | 'periods' | 'isHome'>
  ownLabel: string
  opponentLabel: string
}>()

const WIDTH = 600
const HEIGHT = 120
const MID = HEIGHT / 2

const series = computed(() => momentumSeries(props.analysis.momentum ?? [], props.analysis.periods, props.analysis.isHome))
const home = computed(() => (props.analysis.isHome === false ? props.opponentLabel : props.ownLabel))
const away = computed(() => (props.analysis.isHome === false ? props.ownLabel : props.opponentLabel))

const domain = computed(() => {
  const times = series.value.points.map(([time]) => time)
  return times.length ? { from: Math.min(...times), to: Math.max(...times) } : { from: 0, to: 1 }
})
const peak = computed(() => Math.max(1e-6, ...series.value.points.map(([, value]) => Math.abs(value ?? 0))))
const sx = (time: number) => ((time - domain.value.from) / Math.max(1, domain.value.to - domain.value.from)) * WIDTH
const sy = (value: number) => MID - (value / peak.value) * (MID - 4)

/** Geglaetteter Pfad je zusammenhaengendem Abschnitt, als Flaeche zur Mittellinie geschlossen. */
const paths = computed(() => {
  const segments: [number, number][][] = []
  let current: [number, number][] = []
  for (const [time, value] of series.value.points) {
    if (value === null) {
      if (current.length) segments.push(current)
      current = []
    } else current.push([sx(time), sy(value)])
  }
  if (current.length) segments.push(current)
  return segments.map((points) => {
    let d = `M${points[0]![0]},${MID} L${points[0]![0]},${points[0]![1]}`
    for (let index = 0; index < points.length - 1; index += 1) {
      const p0 = points[Math.max(0, index - 1)]!
      const p1 = points[index]!
      const p2 = points[index + 1]!
      const p3 = points[Math.min(points.length - 1, index + 2)]!
      d += ` C${p1[0] + (p2[0] - p0[0]) / 6},${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6},${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]},${p2[1]}`
    }
    return `${d} L${points.at(-1)![0]},${MID} Z`
  })
})
const periodMarks = computed(() => props.analysis.periods.map((period) => ({ number: period.number, x: sx(period.startS) })))
// Farben wie in den anderen Grafiken: eigene Mannschaft gruen, Gegner orange.
const OWN = '#163a2c'
const OPPONENT = '#c9772f'
const homeColor = computed(() => (props.analysis.isHome === false ? OPPONENT : OWN))
const awayColor = computed(() => (props.analysis.isHome === false ? OWN : OPPONENT))
const clipId = useId()
const label = computed(() => `Spielverlauf, Anteil der Aktionen in der gegnerischen Hälfte: ${home.value} ${series.value.homeShare ?? 0} %, ${away.value} ${series.value.awayShare ?? 0} %`)
</script>

<template>
  <div>
    <div class="mb-2 flex justify-between gap-2 text-xs">
      <p><span class="font-display text-lg font-extrabold" :style="{ color: homeColor }">{{ series.homeShare ?? '–' }} %</span> <span class="text-[#5b625d]">{{ home }}</span></p>
      <p class="text-right"><span class="text-[#5b625d]">{{ away }}</span> <span class="font-display text-lg font-extrabold" :style="{ color: awayColor }">{{ series.awayShare ?? '–' }} %</span></p>
    </div>
    <svg :viewBox="`0 0 ${WIDTH} ${HEIGHT}`" class="h-28 w-full" preserveAspectRatio="none" role="img" :aria-label="label">
      <defs>
        <clipPath :id="`${clipId}-top`"><rect x="0" y="0" :width="WIDTH" :height="MID" /></clipPath>
        <clipPath :id="`${clipId}-bottom`"><rect x="0" :y="MID" :width="WIDTH" :height="MID" /></clipPath>
      </defs>
      <line x1="0" :y1="MID" :x2="WIDTH" :y2="MID" stroke="#dfe0d9" />
      <line v-for="mark in periodMarks" :key="mark.number" :x1="mark.x" y1="0" :x2="mark.x" :y2="HEIGHT" stroke="#eef0ea" stroke-dasharray="4 4" />
      <g v-for="(path, index) in paths" :key="index">
        <path :d="path" :fill="homeColor" fill-opacity=".85" :clip-path="`url(#${clipId}-top)`" />
        <path :d="path" :fill="awayColor" fill-opacity=".85" :clip-path="`url(#${clipId}-bottom)`" />
      </g>
    </svg>
    <p class="mt-1 text-[11px] text-[#7b827d]">Oben: Druck von {{ home }} · unten: Druck von {{ away }}</p>
  </div>
</template>
