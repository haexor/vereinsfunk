<script setup lang="ts">
import { TrendingDown, TrendingUp } from '@lucide/vue'
import type { Component } from 'vue'
import { kpiTrend } from '../utils/kpiTrend'

// Kennzahl-Kachel fuer Dashboard und Auswertung. Mit Symbol ist sie die groessere Variante des
// Dashboards; ein Trend gegenueber dem Vorzeitraum erscheint nur, wenn er berechnet wurde.
const props = defineProps<{
  value: string | number
  label: string
  icon?: Component
  iconClass?: string
  trend?: number | null
  lowerIsBetter?: boolean
}>()

const trendInfo = computed(() => kpiTrend(props.trend, props.lowerIsBetter))
</script>

<template>
  <article class="card p-4" :class="{ 'sm:p-5': icon }">
    <div v-if="icon" class="mb-5 flex items-start justify-between">
      <span class="grid h-9 w-9 place-items-center rounded-xl" :class="iconClass"><component :is="icon" :size="17" /></span>
    </div>
    <div class="font-display text-2xl font-extrabold tracking-[-.04em]" :class="{ 'sm:text-[29px]': icon }">{{ value }}</div>
    <div class="mt-1 flex items-center gap-1 text-[11px] text-[#7a817d]">
      <span class="font-semibold text-ink">{{ label }}</span>
      <span v-if="trendInfo" class="flex items-center gap-0.5" :class="trendInfo.good ? 'text-emerald-700' : 'text-red-700'">
        <component :is="trendInfo.rising ? TrendingUp : TrendingDown" :size="11" />{{ trendInfo.label }}
      </span>
    </div>
  </article>
</template>
