<script setup lang="ts">
import { Upload } from '@lucide/vue'
import { z } from 'zod'
import { sha256Hex } from '~/utils/sha256'

const {
  organizationId,
  departmentId: activeDepartmentId,
} = await useActiveScope()
const api = useApiClient()

const workshopFile = ref<File | null>(null)
const workshopResultFile = ref<File | null>(null)
const workshopPreviewUrl = ref('')
const savingWorkshopResult = ref(false)
const savedWorkshopAssetId = ref<string | null>(null)
const saveWorkshopError = ref('')

function updateWorkshopPreview(file: File) {
  if (workshopPreviewUrl.value) URL.revokeObjectURL(workshopPreviewUrl.value)
  workshopPreviewUrl.value = URL.createObjectURL(file)
}

function openPhotoWorkshop(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0] ?? null
  ;(event.target as HTMLInputElement).value = ''
  if (!file) return
  workshopFile.value = file
}

function acceptWorkshopFile(file: File) {
  workshopResultFile.value = file
  updateWorkshopPreview(file)
  savedWorkshopAssetId.value = null
  saveWorkshopError.value = ''
  workshopFile.value = null
}

function closePhotoWorkshop() {
  workshopFile.value = null
}

function reopenPhotoWorkshop() {
  if (workshopResultFile.value) workshopFile.value = workshopResultFile.value
}

async function saveWorkshopResult() {
  if (!workshopResultFile.value || !organizationId.value || savingWorkshopResult.value) return
  savingWorkshopResult.value = true
  saveWorkshopError.value = ''
  try {
    const file = workshopResultFile.value
    const initiated = await api.request('/v1/media/uploads', {
      method: 'POST',
      body: {
        organizationId: organizationId.value,
        departmentId: activeDepartmentId.value ?? null,
        filename: file.name,
        mimeType: file.type,
        byteSize: file.size,
      },
    }, z.object({ assetId: z.uuid(), uploadUrl: z.url() }))
    const uploaded = await fetch(initiated.uploadUrl, {
      method: 'PUT', body: file, headers: { 'content-type': file.type },
    })
    if (!uploaded.ok) throw new Error('upload_failed')
    const completed = await api.request(`/v1/media/${initiated.assetId}/complete`, {
      method: 'POST', body: { sha256: await sha256Hex(file) },
    }, z.object({
      accepted: z.literal(true),
      uploadStatus: z.enum(['initiated', 'uploaded', 'normalizing', 'ready', 'quarantined', 'failed', 'deleted']),
    }))
    if (completed.uploadStatus !== 'ready') throw new Error('image_processing_failed')
    savedWorkshopAssetId.value = initiated.assetId
  } catch {
    saveWorkshopError.value = 'Das bearbeitete Bild konnte nicht gespeichert werden.'
  } finally {
    savingWorkshopResult.value = false
  }
}

onBeforeUnmount(() => {
  if (workshopPreviewUrl.value) URL.revokeObjectURL(workshopPreviewUrl.value)
})
</script>

<template>
  <div>
    <header class="mb-8">
      <div class="eyebrow mb-3">Vereinsprofil</div>
      <h1 class="font-display text-3xl font-extrabold tracking-[-.04em]">Bildstil</h1>
      <p class="mt-2 text-sm text-[#727a75]">
        Bearbeite Testfotos direkt mit Zuschnitt, Bildstil, Rahmen und Vereinslogo.
      </p>
    </header>

    <PhotoImageWorkshop
      v-if="workshopFile"
      :file="workshopFile"
      :organization-id="organizationId ?? ''"
      :department-id="activeDepartmentId ?? null"
      @save="acceptWorkshopFile"
      @cancel="closePhotoWorkshop"
    />

    <section v-else class="card overflow-hidden">
      <div class="border-b border-[#e9ebe4] p-6">
        <h2 class="font-display text-base font-bold">Bildwerkstatt</h2>
        <p class="mt-1 text-xs text-[#7a817c]">
          Testfoto auswählen und direkt in der Bildwerkstatt bearbeiten.
        </p>
        <div class="mt-4 flex flex-wrap gap-2">
          <label
            class="focus-ring inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-forest px-3 py-2 text-xs font-semibold text-white"
          >
            <Upload :size="14" />
            Testfoto auswählen
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              class="sr-only"
              @change="openPhotoWorkshop"
            />
          </label>
          <button
            v-if="workshopResultFile"
            type="button"
            class="focus-ring rounded-lg border border-[#dfe0d9] px-3 py-2 text-xs font-semibold"
            @click="reopenPhotoWorkshop"
          >
            Erneut bearbeiten
          </button>
          <button
            v-if="workshopResultFile && !savedWorkshopAssetId"
            type="button"
            :disabled="savingWorkshopResult"
            class="focus-ring rounded-lg border border-[#dfe0d9] px-3 py-2 text-xs font-semibold disabled:opacity-60"
            @click="saveWorkshopResult"
          >
            {{ savingWorkshopResult ? 'Wird gespeichert …' : 'In Medien speichern' }}
          </button>
        </div>
        <p v-if="savedWorkshopAssetId" class="mt-3 text-xs text-emerald-700">
          Privat gespeichert. <NuxtLink :to="`/erstellen?mediaAssetId=${savedWorkshopAssetId}`" class="underline">Für einen Beitrag verwenden</NuxtLink> führt dich zur verpflichtenden Personen-Prüfung.
        </p>
        <p v-else-if="saveWorkshopError" class="mt-3 text-xs text-red-700">{{ saveWorkshopError }}</p>
      </div>

      <div class="bg-[#f7f8f6] p-4">
        <img
          v-if="workshopPreviewUrl"
          :src="workshopPreviewUrl"
          alt="Vorschau des bearbeiteten Testfotos"
          class="mx-auto max-h-[min(60vh,720px)] w-full rounded-xl object-contain"
        />
        <div
          v-else
          class="flex min-h-72 items-center justify-center rounded-xl border border-dashed border-[#cfd5ce] px-6 text-center text-sm text-[#7a817c]"
        >
          Wähle ein Testfoto aus, um es direkt in der Bildwerkstatt zu bearbeiten.
        </div>
      </div>
    </section>
  </div>
</template>
