<script setup lang="ts">
import { LoaderCircle, Upload } from '@lucide/vue'
import { curatedFontPairings, type CuratedFontPairing } from '@vereinsfunk/domain'
import type { ActiveScopeLevel } from '../composables/useActiveScope'
import type { BrandAssetRow } from '../composables/useBrandAssets'

type FontRole = 'display' | 'body'
interface LicenseDraft { licenseHolder: string; licenseNote: string; confirmed: boolean }

// Schriften der aktiven Ebene: kuratiertes Paar (nur Verein), eigene Schriftdateien mit
// Lizenzbestaetigung und die Auswahl als Ueberschriften-/Fliesstext-Schrift.
defineProps<{
  level: ActiveScopeLevel
  displayFontKey: string
  uploading: boolean
  uploadError: string
  pendingLicenseAssets: readonly BrandAssetRow[]
  // Liefert den (bei Bedarf neu angelegten) Entwurf aus useBrandAssets; die Felder sind Teil
  // dieses Entwurfs, nicht der Props.
  licenseDraftFor: (assetId: string) => LicenseDraft
  confirmingLicenseAssetId: string | null
  selectableFontAssets: readonly BrandAssetRow[]
  activeFontAssetIds: Readonly<Record<FontRole, string | null>>
  locked: ReadonlySet<string>
  assetOrigin: (asset: BrandAssetRow) => string
}>()
const emit = defineEmits<{
  'select-pairing': [pairing: CuratedFontPairing]
  upload: [event: Event]
  'confirm-license': [assetId: string]
  'toggle-font': [role: FontRole, assetId: string]
}>()
</script>

<template>
  <section class="card p-6">
    <h2 class="font-display text-base font-bold">Schriften</h2>
    <template v-if="level === 'organization'">
      <p class="mt-2 text-xs text-[#7a817c]">
        Kuratiertes Paar wählen oder eine eigene Schrift hochladen.
      </p>
      <div class="mt-4 grid gap-2 sm:grid-cols-2">
        <label
          v-for="pairing in curatedFontPairings"
          :key="pairing.key"
          class="focus-ring relative cursor-pointer rounded-xl border p-3"
          :class="
            displayFontKey === pairing.displayFontKey
              ? 'border-forest bg-[#f2f6e9]'
              : 'border-[#e1e2db]'
          "
        >
          <input
            :checked="displayFontKey === pairing.displayFontKey"
            type="radio"
            :value="pairing.displayFontKey"
            class="sr-only"
            @change="emit('select-pairing', pairing)"
          />
          <strong class="block text-xs">{{ pairing.label }}</strong>
        </label>
      </div>
    </template>
    <!-- Abteilungen/Mannschaften waehlen kein eigenes kuratiertes Paar (dafuer fehlt die
           Spalte bewusst, siehe Migration) -- nur eine eigene Schriftdatei oder Erben. -->
    <p v-else class="mt-2 text-xs text-[#7a817c]">
      Erbt das kuratierte Paar des Vereins, sofern hier keine eigene Schrift ausgewählt ist.
    </p>

    <div class="mt-6 border-t border-[#eceee7] pt-4">
      <p class="text-xs font-semibold">Eigene Schrift</p>
      <label
        class="focus-ring relative mt-2 flex w-fit cursor-pointer items-center gap-2 rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-xs font-semibold"
      >
        <input
          type="file"
          accept=".ttf,.otf,.woff2,font/ttf,font/otf,font/woff2"
          class="sr-only"
          :disabled="uploading"
          @change="emit('upload', $event)"
        />
        <LoaderCircle v-if="uploading" :size="14" class="animate-spin" /><Upload
          v-else
          :size="14"
        />
        Schriftdatei hochladen
      </label>
      <p v-if="uploadError" class="mt-2 text-[11px] text-amber-800">{{ uploadError }}</p>

      <div
        v-for="asset in pendingLicenseAssets"
        :key="asset.id"
        class="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3"
      >
        <p class="text-xs font-semibold">
          {{ asset.fontFamily }} ({{ asset.fontWeight }}, {{ asset.fontStyle }}) — Lizenz noch
          zu bestätigen
        </p>
        <input
          v-model="licenseDraftFor(asset.id).licenseHolder"
          type="text"
          placeholder="Rechteinhaber"
          class="mt-2 w-full rounded-lg border border-[#dfe0d9] px-2 py-1.5 text-xs"
        />
        <input
          v-model="licenseDraftFor(asset.id).licenseNote"
          type="text"
          placeholder="Notiz (optional)"
          class="mt-2 w-full rounded-lg border border-[#dfe0d9] px-2 py-1.5 text-xs"
        />
        <label class="mt-2 flex items-center gap-1.5 text-[11px]">
          <input
            v-model="licenseDraftFor(asset.id).confirmed"
            type="checkbox"
            class="h-4 w-4 accent-[#163a2c]"
          />
          Wir besitzen eine Lizenz, die die Nutzung in unseren Social-Media-Beiträgen erlaubt.
        </label>
        <button
          class="focus-ring mt-2 rounded-lg bg-forest px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-50"
          :disabled="
            !licenseDraftFor(asset.id).confirmed ||
            !licenseDraftFor(asset.id).licenseHolder.trim() ||
            confirmingLicenseAssetId === asset.id
          "
          @click="emit('confirm-license', asset.id)"
        >
          Lizenz bestätigen
        </button>
      </div>

      <div v-if="selectableFontAssets.length" class="mt-4 space-y-1.5">
        <p class="text-[11px] font-semibold text-[#7b827d]">Verfügbare eigene Schriften</p>
        <div
          v-for="asset in selectableFontAssets"
          :key="asset.id"
          class="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#f4f6f1] px-3 py-1.5 text-[11px]"
        >
          <span>{{ asset.fontFamily }} — {{ assetOrigin(asset) }}</span>
          <span class="flex items-center gap-2">
            <!-- Gesperrt wie Logo und Farben: saveDepartment() laesst gesperrte Felder aus,
                 eine Auswahl hier waere nach dem Speichern still wieder weg. -->
            <button
              type="button"
              class="focus-ring underline disabled:opacity-50"
              :aria-pressed="activeFontAssetIds.display === asset.id"
              :class="activeFontAssetIds.display === asset.id && 'font-bold'"
              :disabled="locked.has('displayFontAssetId')"
              @click="emit('toggle-font', 'display', asset.id)"
            >
              als Überschriften-Schrift
            </button>
            <button
              type="button"
              class="focus-ring underline disabled:opacity-50"
              :aria-pressed="activeFontAssetIds.body === asset.id"
              :class="activeFontAssetIds.body === asset.id && 'font-bold'"
              :disabled="locked.has('bodyFontAssetId')"
              @click="emit('toggle-font', 'body', asset.id)"
            >
              als Fließtext-Schrift
            </button>
          </span>
        </div>
      </div>
    </div>
  </section>
</template>
