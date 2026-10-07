<script setup lang="ts">
import { ArrowLeft, Blocks } from '@lucide/vue'
import { AppModuleSchema } from '@vereinsfunk/contracts'
import { appModuleRegistry, blockedByLabel, responsibleForBlock } from '../modules/registry'
import { resolveSafeRedirect } from '../utils/safeRedirect'

// Paket 051, PR 3: Ziel von middleware/module.global.ts, wenn eine Seite zu einem Modul gehoert,
// das im aktiven Arbeitsbereich nicht wirkt. Erklaert, wo es abgeschaltet ist und wer es wieder
// einschalten kann -- statt eines leeren Bildschirms oder einer Kette von 403-Fehlern.
const route = useRoute()
const module = computed(() => AppModuleSchema.safeParse(route.query.modul).data ?? null)
const definition = computed(() => (module.value ? appModuleRegistry[module.value] : null))
const { active, isEnabled } = await useScopeModules()
const state = computed(() => active.value?.modules.find((item) => item.module === module.value) ?? null)
const scopeName = computed(() => active.value?.name ?? 'diesem Bereich')
const reason = computed(() => (active.value && state.value ? blockedByLabel(state.value.blockedBy, active.value.scope) : ''))
// Abwaehlen kann nur die Ebene selbst rueckgaengig machen; ein Tarif oder eine hoehere Ebene
// liegt ausserhalb dessen, was die Seite "Module" hier aendern kann.
const canFixHere = computed(() => active.value?.canEdit === true && state.value?.blockedBy === active.value.scope)

// Wechselt die Person in einen Bereich, in dem das Modul wirkt, geht es zur urspruenglichen Seite.
watch(
  () => (module.value ? isEnabled(module.value) : false),
  (enabled) => {
    if (enabled) void navigateTo(resolveSafeRedirect(route.query.von, '/'))
  },
)
</script>

<template>
  <section class="card mx-auto max-w-xl p-8 text-center">
    <span class="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-[#eef1ea] text-forest">
      <component :is="definition?.icon ?? Blocks" :size="22" />
    </span>
    <h1 class="font-display text-xl font-extrabold tracking-[-.03em] text-ink">
      {{ definition ? `${definition.label} ist in ${scopeName} nicht aktiviert` : 'Dieses Modul ist hier nicht aktiviert' }}
    </h1>
    <p v-if="reason" class="mt-2 text-sm text-[#6c756f]">Grund: {{ reason }}.</p>
    <p class="mt-1 text-sm text-[#6c756f]">Zuständig: {{ responsibleForBlock(state?.blockedBy ?? null) }}.</p>
    <div class="mt-6 flex flex-wrap justify-center gap-3">
      <NuxtLink v-if="canFixHere" to="/einstellungen/module" class="focus-ring inline-flex items-center gap-2 rounded-xl bg-forest px-5 py-2.5 text-xs font-bold text-white">
        <Blocks :size="15" /> Module verwalten
      </NuxtLink>
      <NuxtLink to="/" class="focus-ring inline-flex items-center gap-2 rounded-xl border border-[#dfe0d9] px-5 py-2.5 text-xs font-semibold text-ink">
        <ArrowLeft :size="15" /> Zur Übersicht
      </NuxtLink>
    </div>
  </section>
</template>
