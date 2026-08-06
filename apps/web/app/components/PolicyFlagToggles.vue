<script setup lang="ts">
import type { PolicyFlag, PolicyFlagState, PolicySetting } from '@vereinsfunk/contracts'

// Drei Zustaende je Feld (Plan 023, "Richtlinienoberflaeche, kleine Fassung"): geerbt (grauer
// Wert, erbt von oben), verschaerft (eigener Wert, aktiv gesetzt), gesperrt (eine hoehere Ebene
// hat bereits verschaerft -- ein Lockern hier waere wirkungslos, das Bedienelement ist deshalb
// deaktiviert statt einen Effekt zu suggerieren, den es nicht gibt).
const props = defineProps<{ setting: PolicySetting; pending: boolean }>()
const emit = defineEmits<{ change: [flag: PolicyFlag, value: boolean | null] }>()

const fields: { flag: PolicyFlag; label: string; restrictedLabel: string }[] = [
  { flag: 'invite_allowed', label: 'Einladungsrecht', restrictedLabel: 'Einladen hier gesperrt' },
  { flag: 'posts_visible_org_wide', label: 'Vereinsweite Sichtbarkeit', restrictedLabel: 'Nur intern sichtbar' },
]

function stateFor(flag: PolicyFlag): PolicyFlagState {
  return flag === 'invite_allowed' ? props.setting.inviteAllowed : props.setting.postsVisibleOrgWide
}

function toggle(flag: PolicyFlag) {
  const state = stateFor(flag)
  emit('change', flag, state.ownValue === false ? null : false)
}
</script>

<template>
  <div class="flex flex-wrap gap-3">
    <div v-for="field in fields" :key="field.flag" class="flex items-center gap-1.5 text-[10px]">
      <span class="font-semibold text-[#5b625d]">{{ field.label }}:</span>
      <span v-if="stateFor(field.flag).lockedByAncestor" class="rounded-full bg-[#eef1ea] px-2 py-0.5 text-[#9aa096]">
        gesperrt <span class="text-[#c2c7bd]">(höhere Ebene hat das bereits eingeschränkt)</span>
      </span>
      <button
        v-else-if="stateFor(field.flag).canEdit"
        type="button"
        :disabled="pending"
        :aria-pressed="stateFor(field.flag).ownValue === false"
        :aria-label="`${field.label} für ${setting.name}`"
        class="focus-ring rounded-full px-2 py-0.5 disabled:opacity-60"
        :class="stateFor(field.flag).ownValue === false ? 'bg-amber-100 text-amber-800' : 'bg-[#eef1ea] text-[#5b625d]'"
        @click="toggle(field.flag)"
      >
        {{ stateFor(field.flag).ownValue === false ? field.restrictedLabel : 'geerbt (erlaubt)' }}
      </button>
      <span v-else class="rounded-full bg-[#eef1ea] px-2 py-0.5 text-[#5b625d]">
        {{ stateFor(field.flag).effective ? 'erlaubt' : 'eingeschränkt' }}
      </span>
    </div>
  </div>
</template>
