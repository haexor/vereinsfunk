<template>
  <div class="grid min-h-screen place-items-center bg-oat px-4 py-10">
    <div class="w-full max-w-[420px]">
      <div class="mb-7 flex justify-center">
        <div class="inline-flex rounded-xl bg-forest px-3 py-2">
          <AppLogo />
        </div>
      </div>
      <div class="card p-6 sm:p-8"><slot /></div>
    </div>
  </div>
</template>
