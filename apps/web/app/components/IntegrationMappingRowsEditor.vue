<script setup lang="ts">
export type MappingRow = { column: string; field: string }
export type MappingTarget = { value: string; label: string }

defineProps<{ targets: readonly MappingTarget[] }>()
const rows = defineModel<MappingRow[]>({ required: true })

// Stabile Schluessel je Zeilenobjekt statt des Index: mit dem Index als Schluessel uebernaehme nach dem
// Entfernen einer Zeile die naechste den Eingabe- und Auswahlzustand der entfernten.
const rowKeys = new WeakMap<MappingRow, number>()
let nextRowKey = 0
function keyOf(row: MappingRow): number {
  let key = rowKeys.get(row)
  if (key === undefined) {
    key = nextRowKey++
    rowKeys.set(row, key)
  }
  return key
}

function setRowField(row: MappingRow, value: string) {
  row.field = value === '__none__' ? '' : value
}
function addRow() {
  rows.value.push({ column: '', field: '' })
}
function removeRow(row: MappingRow) {
  rows.value.splice(rows.value.indexOf(row), 1)
}
</script>

<template>
  <div v-for="row in rows" :key="keyOf(row)" class="mb-2 flex flex-wrap items-center gap-2"><input v-model="row.column" placeholder="Spalte in der Datei" class="focus-ring w-44 rounded-lg border border-[#dfe0d9] p-2 text-xs" /><span class="text-xs text-[#9aa096]">→</span><Select :model-value="row.field || '__none__'" @update:model-value="(value: unknown) => setRowField(row, value as string)"><SelectTrigger class="w-auto rounded-lg p-2 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__none__">Internes Feld wählen …</SelectItem><SelectItem v-for="target in targets" :key="target.value" :value="target.value">{{ target.label }}</SelectItem></SelectContent></Select><button type="button" class="focus-ring text-xs text-[#8a9186] hover:text-amber-800" @click="removeRow(row)">Entfernen</button></div>
  <button type="button" class="focus-ring text-xs font-semibold text-forest" @click="addRow">+ Zeile hinzufügen</button>
</template>
