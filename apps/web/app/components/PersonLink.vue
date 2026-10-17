<script setup lang="ts">
import { personProfilePath } from '../utils/personProfile'

// Name einer Person als Link auf ihr Profil auf Vereinsebene. Ohne personId (z. B. eine nicht
// zugeordnete Veo-Zeile) bleibt der Name reiner Text, ohne Fokusziel. Klassen des Aufrufers
// (truncate, Schrift) gehen an das Wurzelelement. Die dezente Unterstreichung zeigt, dass der Name
// klickbar ist; das senkrechte Padding vergroessert nur die Trefferflaeche, nicht die Zeilenhoehe.
const props = defineProps<{ personId?: string | null }>()
const path = computed(() => personProfilePath(props.personId))
</script>

<template>
  <NuxtLink v-if="path" :to="path" class="focus-ring rounded-sm py-3.5 underline decoration-[#c8cdc4] underline-offset-2 hover:decoration-forest"><slot /></NuxtLink>
  <span v-else><slot /></span>
</template>
