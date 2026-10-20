<script setup lang="ts">
import { Menu, X } from '@lucide/vue'
import type { StyleValue } from 'vue'

withDefaults(
  defineProps<{
    // Flaeche von Kopfzeile und Sidebar: als Stil (Vereinsmarke) oder als Klasse (Produktfarbe).
    surfaceStyle?: StyleValue
    surfaceClass?: string
    // Lesbare Vordergrundfarbe auf dieser Flaeche (Logo-Schriftzug, Menue-Knopf).
    textClass?: string
    // Breite des Inhaltsrahmens.
    contentClass?: string
  }>(),
  { surfaceStyle: undefined, surfaceClass: '', textClass: 'text-white', contentClass: 'max-w-[1280px]' },
)

const mobileOpen = ref(false)
const route = useRoute()

watch(
  () => route.path,
  () => {
    mobileOpen.value = false
  },
)
</script>

<template>
  <!--
    Authenticated session and scope data are intentionally only available in the browser.
    Rendering the shell on the server would therefore produce an empty sidebar and page,
    which differs from the first client render and causes Vue hydration mismatches.
  -->
  <ClientOnly>
    <div class="min-h-screen bg-oat lg:flex lg:h-screen lg:overflow-hidden">
      <header
        class="sticky top-0 z-40 flex h-16 items-center justify-between px-4 lg:hidden"
        :class="surfaceClass"
        :style="surfaceStyle"
      >
        <AppLogo :text-class="textClass" />
        <button
          class="focus-ring rounded-lg p-2"
          :class="textClass"
          aria-label="Navigation öffnen"
          @click="mobileOpen = !mobileOpen"
        >
          <X v-if="mobileOpen" :size="22" />
          <Menu v-else :size="22" />
        </button>
      </header>

      <div
        v-if="mobileOpen"
        class="fixed inset-0 z-30 bg-ink/40 backdrop-blur-sm lg:hidden"
        @click="mobileOpen = false"
      />
      <aside
        class="fixed bottom-0 left-0 top-0 z-30 flex w-[268px] flex-col overflow-y-auto px-4 py-5 transition-transform duration-200 lg:sticky lg:h-screen lg:min-h-0 lg:translate-x-0"
        :class="[surfaceClass, mobileOpen ? 'translate-x-0 pt-20' : '-translate-x-full']"
        :style="surfaceStyle"
      >
        <div class="hidden px-2 pb-7 lg:block"><AppLogo :text-class="textClass" /></div>
        <slot name="sidebar" />
      </aside>

      <!-- relative: absolut positionierte Inhalte (sr-only, versteckte Datei-Inputs) muessen in
           main bleiben; sonst verlaengern sie das Dokument und die Shell scrollt als Ganzes. -->
      <main class="relative min-w-0 flex-1 lg:h-screen lg:min-h-0 lg:overflow-y-auto">
        <div class="mx-auto w-full px-5 py-8 sm:px-10" :class="contentClass">
          <slot />
        </div>
      </main>
      <slot name="overlay" />
    </div>
    <template #fallback>
      <main
        class="grid min-h-screen place-items-center bg-oat px-5 text-sm text-[#7b827d]"
        aria-busy="true"
      >
        Anwendung wird geladen …
      </main>
    </template>
  </ClientOnly>
</template>
