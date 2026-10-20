<script setup lang="ts">
import { Upload } from '@lucide/vue'
import type { ActiveScopeLevel } from '../composables/useActiveScope'
import type { BrandAssetRow } from '../composables/useBrandAssets'

// Logo-Dateien der aktiven Ebene und die vom Verein geerbten Logos. Auswahl, Upload und Loeschen
// fuehrt die Seite ueber useBrandAssets aus.
defineProps<{
  level: ActiveScopeLevel
  ownLogoAssets: readonly BrandAssetRow[]
  selectableLogoAssets: readonly BrandAssetRow[]
  assetSignedUrls: Readonly<Record<string, string>>
  activeLogoAssetId: string | null
  logoLocked: boolean
  uploading: boolean
  deletingAssetId: string | null
  deleteError: string
  assetOrigin: (asset: BrandAssetRow) => string
}>()
const emit = defineEmits<{ upload: [event: Event]; toggle: [assetId: string]; remove: [assetId: string] }>()

// Alte Asset-Arten werden beim Anzeigen bewusst nicht mehr unterschieden. Die Datenmigration
// vereinheitlicht sie auf logo_primary; diese Zuordnung hält auch wiederhergestellte Altbestände
// verständlich.
const LOGO_ASSET_LABEL = 'Logo'
</script>

<template>
  <section class="card p-6">
    <h2 class="font-display text-base font-bold">Logo</h2>
    <p class="mt-2 text-xs text-[#7a817c]">
      Hinterlegt die Logo-Dateien, die ihr in euren Beiträgen verwenden möchtet. „Als Logo“
      legt die aktuell verwendete Datei dieser Ebene fest.
    </p>
    <div class="mt-4 flex flex-wrap gap-2">
      <label
        class="focus-ring relative flex cursor-pointer items-center gap-1.5 rounded-lg border border-[#dfe0d9] px-3 py-1.5 text-[11px] font-semibold"
      >
        <input
          type="file"
          accept="image/png,image/jpeg,image/svg+xml"
          class="sr-only"
          :disabled="uploading"
          @change="emit('upload', $event)"
        />
        <Upload :size="12" /> Logo hochladen
      </label>
    </div>
    <div v-if="ownLogoAssets.length" class="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4">
      <div
        v-for="asset in ownLogoAssets"
        :key="asset.id"
        class="rounded-xl border p-2 text-center"
        :class="
          activeLogoAssetId === asset.id ? 'border-forest bg-[#f2f6e9]' : 'border-[#e1e2db]'
        "
      >
        <img
          v-if="assetSignedUrls[asset.id]"
          :src="assetSignedUrls[asset.id]"
          :alt="LOGO_ASSET_LABEL"
          class="mx-auto h-12 w-12 object-contain"
        />
        <p class="mt-1 text-[9px] text-[#9aa096]">{{ LOGO_ASSET_LABEL }}</p>
        <button
          type="button"
          class="focus-ring text-[9px] underline disabled:opacity-50"
          :aria-pressed="activeLogoAssetId === asset.id"
          :disabled="level !== 'organization' && logoLocked"
          @click="emit('toggle', asset.id)"
        >
          {{ activeLogoAssetId === asset.id ? 'Logo entfernen' : 'als Logo' }}
        </button>
        <button
          type="button"
          class="focus-ring mt-1 block w-full text-[9px] text-amber-800 underline disabled:opacity-50"
          :disabled="deletingAssetId === asset.id"
          @click="emit('remove', asset.id)"
        >
          {{ deletingAssetId === asset.id ? 'Wird entfernt …' : 'löschen' }}
        </button>
      </div>
    </div>
    <p v-if="deleteError" class="mt-2 text-[11px] text-amber-800">
      {{ deleteError }}
    </p>
    <div v-if="level !== 'organization' && selectableLogoAssets.length" class="mt-4">
      <p class="text-[11px] font-semibold text-[#7b827d]">
        Wählbar (vom Verein) — erneut
        klicken entfernt die Auswahl
      </p>
      <div class="mt-2 flex flex-wrap gap-2">
        <button
          v-for="asset in selectableLogoAssets"
          :key="asset.id"
          type="button"
          class="focus-ring rounded-lg px-2 py-1 text-[10px] disabled:opacity-50"
          :class="activeLogoAssetId === asset.id ? 'bg-forest text-white' : 'bg-[#f4f6f1]'"
          :aria-pressed="activeLogoAssetId === asset.id"
          :disabled="logoLocked"
          @click="emit('toggle', asset.id)"
        >
          {{ LOGO_ASSET_LABEL }} — {{ assetOrigin(asset) }}
        </button>
      </div>
    </div>
  </section>
</template>
