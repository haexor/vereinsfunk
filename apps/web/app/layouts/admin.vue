<script setup lang="ts">
async function logout() {
  await signOut()
  await navigateTo('/anmelden')
}

const adminNav = [
  { label: 'Übersicht', to: '/plattform-admin' },
  { label: 'Admins', to: '/plattform-admin/admins' },
  { label: 'Einstellungen', to: '/plattform-admin/einstellungen' },
  { label: 'LLM-Provider', to: '/plattform-admin/llm' },
]
</script>

<template>
  <div class="min-h-screen bg-oat">
    <header class="flex flex-wrap items-center justify-between gap-4 bg-forest px-6 py-4 text-white">
      <div class="flex flex-wrap items-center gap-6">
        <AppLogo />
        <nav class="flex flex-wrap gap-1 text-[13px] font-medium" aria-label="Plattform-Administration">
          <NuxtLink
            v-for="item in adminNav"
            :key="item.to"
            :to="item.to"
            class="focus-ring rounded-lg px-3 py-2 hover:bg-white/10"
            active-class="!bg-white/15"
          >
            {{ item.label }}
          </NuxtLink>
        </nav>
      </div>
      <div class="flex items-center gap-3">
        <NuxtLink to="/" class="focus-ring rounded-lg px-3 py-2 text-xs font-semibold hover:bg-white/10">Zum Verein</NuxtLink>
        <button class="focus-ring rounded-lg px-3 py-2 text-xs font-semibold hover:bg-white/10" @click="logout">Abmelden</button>
      </div>
    </header>
    <main class="mx-auto max-w-[1100px] px-6 py-8"><slot /></main>
  </div>
</template>
