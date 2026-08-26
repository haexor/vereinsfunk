import { nextTick, ref, watch } from 'vue'
import { describe, expect, it } from 'vitest'

// Reproduziert die Slot-Form aus PhotoAttachmentList.vue: ein resumtes Foto (initialMediaAssetId)
// muss ueber value: null starten, damit PhotoAttachment.vue's spaetere Zuweisung
// mediaAssetId.value = asset.id eine echte Aenderung ist. Wuerde value bereits bei der Asset-ID
// vorbelegt, waere diese Zuweisung ein No-Op (identischer Wert) und Vue's Reaktivitaet wuerde den
// deep watch nie ausloesen -- das Foto bliebe in mediaAssetIds unsichtbar (stiller Datenverlust).
describe('PhotoAttachmentList slot reactivity', () => {
  it('propagates a resumed photo into mediaAssetIds once hydration sets its value', async () => {
    const assetId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    const slots = ref([{ id: 1, value: null as string | null, initialMediaAssetId: assetId }])
    const mediaAssetIds = ref<string[]>([])
    watch(slots, () => {
      mediaAssetIds.value = slots.value.map((slot) => slot.value).filter((value): value is string => value !== null)
    }, { deep: true })

    // Simuliert PhotoAttachment.vue's onMounted-Hydration: mediaAssetId.value = asset.id
    slots.value[0]!.value = assetId
    await nextTick()

    expect(mediaAssetIds.value).toEqual([assetId])
  })
})
