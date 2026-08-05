<script setup lang="ts">
import { AlertTriangle, Check, LoaderCircle, Upload } from '@lucide/vue'

const config = useRuntimeConfig()
const scope = await useScope()
const loading = ref(true)
const saving = ref(false)
const errorMessage = ref('')
const sanitizedNotice = ref(false)

const colors = reactive({ primary: '#163a2c', accent: '#caff4a' })
const tone = ref<'nahbar' | 'dynamisch' | 'sachlich'>('nahbar')
const logoUrl = ref('')
const logoFile = ref<File | null>(null)
const logoPreviewUrl = ref('')

const organizationId = computed(() => scope.value?.organizationId ?? null)

async function loadBrand() {
  if (!organizationId.value) { loading.value = false; return }
  const supabase = useSupabaseClient()
  const result = await supabase
    .from('organization_brand_profiles')
    .select('primary_color, accent_color, tone, logo_path')
    .eq('organization_id', organizationId.value)
    .maybeSingle()
  if (result.data) {
    colors.primary = result.data.primary_color
    colors.accent = result.data.accent_color
    tone.value = result.data.tone
    if (result.data.logo_path) {
      const signed = await supabase.storage.from('brand-assets').createSignedUrl(result.data.logo_path, 600)
      logoUrl.value = signed.data?.signedUrl ?? ''
    }
  }
  loading.value = false
}
await loadBrand()

function onLogoSelected(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0] ?? null
  logoFile.value = file
  logoPreviewUrl.value = file ? URL.createObjectURL(file) : ''
}

async function save() {
  if (!organizationId.value) return
  saving.value = true
  errorMessage.value = ''
  try {
    const headers = await useAuthHeader()
    if (logoFile.value) {
      const formData = new FormData()
      formData.append('variant', 'light')
      formData.append('file', logoFile.value)
      const uploaded = await $fetch<{ signedUrl: string; sanitized: boolean }>(
        `${config.public.apiBase}/v1/organizations/${organizationId.value}/brand/logo`,
        { method: 'POST', headers, body: formData },
      )
      logoUrl.value = uploaded.signedUrl
      sanitizedNotice.value = uploaded.sanitized
      logoFile.value = null
      logoPreviewUrl.value = ''
    }
    await $fetch(`${config.public.apiBase}/v1/organizations/${organizationId.value}/brand`, {
      method: 'PUT',
      headers,
      body: { primaryColor: colors.primary, accentColor: colors.accent, tone: tone.value, displayFontKey: 'manrope', bodyFontKey: 'dm_sans' },
    })
  } catch {
    errorMessage.value = 'Die Marke konnte nicht gespeichert werden. Bitte erneut versuchen.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-[980px] px-5 py-8 sm:px-10">
    <header class="mb-8">
      <div class="eyebrow mb-3">Vereinsprofil</div>
      <h1 class="font-display text-3xl font-extrabold tracking-[-.04em]">Marke & Tonalität</h1>
      <p class="mt-2 text-sm text-[#727a75]">So erkennt man euren Verein in jedem Beitrag wieder.</p>
    </header>

    <div v-if="loading" class="p-8 text-center text-xs text-[#7b827d]">Wird geladen …</div>
    <template v-else>
      <div class="grid gap-6 lg:grid-cols-2">
        <section class="card p-6">
          <h2 class="font-display text-base font-bold">Erscheinungsbild</h2>
          <div class="mt-5 flex items-center gap-4">
            <img v-if="logoPreviewUrl || logoUrl" :src="logoPreviewUrl || logoUrl" alt="Vereinslogo" class="h-20 w-20 rounded-2xl border border-[#dfe0d9] object-contain p-2" />
            <span v-else class="grid h-20 w-20 place-items-center rounded-2xl bg-forest font-display text-xl font-extrabold text-lime">?</span>
            <label class="focus-ring flex cursor-pointer items-center gap-2 rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-xs font-semibold">
              <input type="file" accept="image/png,image/jpeg,image/svg+xml" class="sr-only" @change="onLogoSelected" />
              <Upload :size="14" /> Logo ersetzen
            </label>
          </div>
          <p v-if="sanitizedNotice" class="mt-2 flex items-center gap-1.5 text-[11px] text-amber-800"><AlertTriangle :size="13" /> Das SVG enthielt nicht unterstützte Elemente, die entfernt wurden.</p>
          <div class="mt-6 grid grid-cols-2 gap-4">
            <label><span class="mb-2 block text-xs font-semibold">Primärfarbe</span><div class="flex items-center gap-2 rounded-xl border border-[#dfe0d9] bg-white p-2"><input v-model="colors.primary" type="color" class="h-8 w-8 border-0 bg-transparent" /><span class="text-xs">{{ colors.primary }}</span></div></label>
            <label><span class="mb-2 block text-xs font-semibold">Akzentfarbe</span><div class="flex items-center gap-2 rounded-xl border border-[#dfe0d9] bg-white p-2"><input v-model="colors.accent" type="color" class="h-8 w-8 border-0 bg-transparent" /><span class="text-xs">{{ colors.accent }}</span></div></label>
          </div>
        </section>
        <section class="card p-6">
          <h2 class="font-display text-base font-bold">Tonalität</h2>
          <p class="mt-2 text-xs text-[#7a817c]">Wie soll euer Verein klingen?</p>
          <div class="mt-5 space-y-2">
            <label v-for="item in [{ id: 'nahbar', label: 'Nahbar & herzlich', text: 'Persönlich, ehrlich und gemeinschaftlich.' }, { id: 'dynamisch', label: 'Dynamisch & motivierend', text: 'Aktiv, emotional und mit viel Energie.' }, { id: 'sachlich', label: 'Klar & informativ', text: 'Präzise, ruhig und auf den Punkt.' }]" :key="item.id" class="focus-ring flex cursor-pointer gap-3 rounded-xl border p-3" :class="tone === item.id ? 'border-forest bg-[#f2f6e9]' : 'border-[#e1e2db]'">
              <input v-model="tone" type="radio" :value="item.id" class="mt-1 accent-[#163a2c]" />
              <span><strong class="block text-xs">{{ item.label }}</strong><span class="mt-1 block text-[10px] text-[#7b827d]">{{ item.text }}</span></span>
            </label>
          </div>
        </section>
      </div>
      <p v-if="errorMessage" class="mt-4 text-sm text-amber-800">{{ errorMessage }}</p>
      <div class="mt-6 flex justify-end">
        <button class="focus-ring flex items-center gap-2 rounded-xl bg-forest px-5 py-3 text-xs font-bold text-white disabled:opacity-60" :disabled="saving" @click="save">
          <LoaderCircle v-if="saving" :size="14" class="animate-spin" /><Check v-else :size="14" /> {{ saving ? 'Wird gespeichert …' : 'Änderungen speichern' }}
        </button>
      </div>
    </template>
  </div>
</template>
