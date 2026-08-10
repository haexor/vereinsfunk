<script setup lang="ts">
defineProps<{
  primaryColor: string
  accentColor: string
  backgroundColor: string
  textColor: string
  onPrimaryColor: string
  displayFontFamily: string
  bodyFontFamily: string
  logoUrl: string
}>()
</script>

<template>
  <section class="card p-6">
    <h2 class="font-display text-base font-bold">Live-Vorschau</h2>
    <div class="mt-4 space-y-3">
      <div class="aspect-[9/16] overflow-hidden rounded-[20px] p-6" :style="{ backgroundColor: primaryColor, color: onPrimaryColor }">
        <div class="flex h-full flex-col justify-between">
          <span class="text-[10px] font-bold tracking-[3px] uppercase" :style="{ fontFamily: bodyFontFamily }">Spieltag</span>
          <h3 class="text-2xl font-extrabold leading-[.95]" :style="{ fontFamily: displayFontFamily, color: accentColor }">Samstag wird laut.</h3>
          <div class="flex items-center justify-between text-[10px] font-bold" :style="{ fontFamily: bodyFontFamily }"><span>Euer Verein</span><img v-if="logoUrl" :src="logoUrl" alt="Logo" class="h-6 w-auto" /></div>
        </div>
      </div>
      <div class="aspect-[4/5] overflow-hidden rounded-[20px] p-5" :style="{ backgroundColor, color: textColor }">
        <span class="text-[9px] font-bold tracking-[2px] uppercase opacity-70" :style="{ fontFamily: bodyFontFamily }">Vereinsfunk</span>
        <p class="mt-4 text-lg font-extrabold leading-tight" :style="{ fontFamily: displayFontFamily }">Drei Punkte. Ein Team.</p>
        <span class="mt-4 inline-block rounded-lg px-3 py-1.5 text-[10px] font-bold" :style="{ backgroundColor: accentColor, color: primaryColor, fontFamily: bodyFontFamily }">Mehr erfahren</span>
      </div>
    </div>
  </section>
</template>
