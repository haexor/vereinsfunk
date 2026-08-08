<template>
  <div class="grid min-h-screen place-items-center bg-oat px-4 py-10">
    <div class="w-full max-w-[420px]">
      <div class="mb-7 flex justify-center">
        <div class="inline-flex rounded-xl bg-forest px-3 py-2">
          <AppLogo />
        </div>
      </div>
      <div class="card p-6 sm:p-8"><slot /></div>
      <footer class="mt-6 flex justify-center gap-4 text-xs text-[#8a9089]">
        <NuxtLink to="/impressum" class="focus-ring hover:text-forest">Impressum</NuxtLink>
        <NuxtLink to="/datenschutz" class="focus-ring hover:text-forest">Datenschutz</NuxtLink>
      </footer>
    </div>
  </div>
</template>
