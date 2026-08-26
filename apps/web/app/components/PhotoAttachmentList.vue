<script setup lang="ts">
// Plan 047, PR 0: hebt die fruehere Grenze aus Plan 045 ("hoechstens ein Foto, kein Karussell")
// auf der UI-Ebene auf, ohne PhotoAttachment.vue selbst anzufassen -- Upload/Personen-Pruefung
// bleiben pro Foto exakt dieselbe, bereits funktionierende Einheit, hier nur mehrfach
// nebeneinander gestellt. Die Reihenfolge der Slots wird zur Reihenfolge in mediaAssetIds und
// spaeter zur position der post_media-Zeilen (routes/content.ts).
const props = withDefaults(defineProps<{ organizationId: string; departmentId: string | null; max?: number; initialMediaAssetIds?: string[] }>(), { max: 10 })
const mediaAssetIds = defineModel<string[]>('mediaAssetIds', { required: true })

// Deckelt jeden Aufrufwert auf die Contract-Obergrenze (CreateCompositionSessionSchema.mediaAssetIds,
// max(10)) -- ein hoeherer max-Wert liesse hier mehr Slots entstehen, als die API je annehmen wuerde.
const effectiveMax = computed(() => Math.min(props.max, 10))

interface Slot { id: number; value: string | null; initialMediaAssetId: string | null }
let nextSlotId = 1
// initialMediaAssetIds wird nur beim Erzeugen der Komponente ausgewertet (Wiederverwendung eines
// Fotos aus der Medienuebersicht per Query-Parameter in erstellen.vue) -- kein reaktiver Watcher,
// derselbe Zeitpunkt wie die Query-Parameter-Auswertung dort. value startet trotzdem bei null:
// PhotoAttachment.vue setzt es erst nach erfolgreicher Hydration auf die Asset-ID. Waere es hier
// schon vorbelegt, wäre diese spätere Zuweisung ein No-Op (identischer Wert) und der deep watch
// unten würde nie feuern -- das wiederverwendete Foto käme nie in mediaAssetIds an.
const slots = ref<Slot[]>(
  props.initialMediaAssetIds?.length
    ? props.initialMediaAssetIds.slice(0, effectiveMax.value).map((assetId) => ({ id: nextSlotId++, value: null, initialMediaAssetId: assetId }))
    : [{ id: 0, value: null, initialMediaAssetId: null }],
)

watch(slots, () => {
  mediaAssetIds.value = slots.value.map((slot) => slot.value).filter((value): value is string => value !== null)
}, { deep: true })

// Ein von aussen gesetztes leeres Array (z.B. Ebenenwechsel in erstellen.vue) waehrend intern noch
// Fotos angehaengt sind, ist ein externer Reset -- dieselbe Reaktion wie PhotoAttachment.vue selbst
// auf ein von aussen gesetztes null zeigt (siehe dessen eigener watch(mediaAssetId, ...)). Der
// Zusatz-Check verhindert eine Schleife: wenn die eigene Herleitung oben mediaAssetIds bereits
// selbst auf [] gesetzt hat, sind alle Slot-Werte zu diesem Zeitpunkt schon null.
watch(mediaAssetIds, (ids) => {
  if (ids.length === 0 && slots.value.some((slot) => slot.value !== null)) {
    slots.value = [{ id: nextSlotId++, value: null, initialMediaAssetId: null }]
  }
})

function addSlot() {
  if (slots.value.length >= effectiveMax.value) return
  slots.value = [...slots.value, { id: nextSlotId++, value: null, initialMediaAssetId: null }]
}
function removeSlot(id: number) {
  const remaining = slots.value.filter((slot) => slot.id !== id)
  // Immer mindestens ein (leerer) Slot sichtbar -- sonst verschwindet die Foto-Anhang-Steuerung
  // komplett aus der Seite, sobald der letzte Slot entfernt wird.
  slots.value = remaining.length > 0 ? remaining : [{ id: nextSlotId++, value: null, initialMediaAssetId: null }]
}
</script>

<template>
  <div class="space-y-3">
    <div v-for="(slot, index) in slots" :key="slot.id" class="rounded-xl border border-[#e1e2db] p-3">
      <div v-if="slots.length > 1" class="mb-1 flex items-center justify-between">
        <span class="text-xs font-semibold text-[#727a75]">Foto {{ index + 1 }}</span>
        <button type="button" class="text-xs text-red-700 underline" @click="removeSlot(slot.id)">Slot entfernen</button>
      </div>
      <PhotoAttachment v-model="slot.value" :organization-id="organizationId" :department-id="departmentId" :initial-media-asset-id="slot.initialMediaAssetId" />
    </div>
    <button v-if="slots.length < effectiveMax" type="button" class="rounded-xl border px-4 py-2 text-sm font-semibold" @click="addSlot">+ Weiteres Foto</button>
  </div>
</template>
