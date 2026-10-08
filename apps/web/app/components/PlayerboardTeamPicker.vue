<script setup lang="ts">
import { Users } from '@lucide/vue'

// Paket 052, PR 3: Mannschaftsauswahl im Kopf der PlayerBoard-Seiten. Nur eine Mannschaft im
// Arbeitsbereich: Name ohne Auswahl. Mehrere: Auswahl, gruppiert nach Abteilung auf Vereinsebene.
const { teams, teamId, team } = await usePlayerboardTeam()
const showDepartment = computed(() => new Set(teams.value.map((item) => item.departmentId)).size > 1)
const model = computed({
  get: () => teamId.value ?? '',
  set: (value: string) => { teamId.value = value || null },
})
</script>

<template>
  <div v-if="teams.length > 1" class="min-w-[220px]">
    <Select v-model="model">
      <SelectTrigger aria-label="Mannschaft auswählen" class="h-11 rounded-xl bg-white px-3 text-sm font-semibold">
        <span class="flex items-center gap-2"><Users :size="16" class="text-forest" /><SelectValue placeholder="Mannschaft wählen" /></span>
      </SelectTrigger>
      <SelectContent>
        <SelectItem v-for="item in teams" :key="item.id" :value="item.id">
          {{ item.name }}<template v-if="showDepartment"> · {{ item.departmentName }}</template>
        </SelectItem>
      </SelectContent>
    </Select>
  </div>
  <span v-else-if="team" class="inline-flex h-11 items-center gap-2 rounded-xl border border-[#dfe0d9] bg-white px-3 text-sm font-semibold text-ink">
    <Users :size="16" class="text-forest" /> {{ team.name }}
  </span>
</template>
