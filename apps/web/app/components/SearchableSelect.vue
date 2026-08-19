<script setup lang="ts">
import { ChevronDown } from '@lucide/vue'

type SearchableSelectItem = { value: string; label: string; description?: string }
type SearchableSelectGroup = { label: string; items: SearchableSelectItem[] }

const props = defineProps<{ groups: SearchableSelectGroup[]; placeholder?: string }>()
const modelValue = defineModel<string>({ required: true })

const open = ref(false)
const query = ref('')
const highlightedIndex = ref(0)
const rootRef = ref<HTMLElement | null>(null)
const searchRef = ref<HTMLInputElement | null>(null)

const allItems = computed(() => props.groups.flatMap((group) => group.items))
const selectedItem = computed(() => allItems.value.find((item) => item.value === modelValue.value) ?? null)

// Substring-Treffer gehen vor, je frueher desto besser; sonst zaehlt eine geordnete Teilfolge --
// das faengt Tippfehler/Auslassungen ab, ohne eine eigene Fuzzy-Bibliothek zu brauchen.
function fuzzyScore(needle: string, haystack: string): number {
  const idx = haystack.indexOf(needle)
  if (idx !== -1) return 1000 - idx
  let needleIndex = 0
  let score = 0
  for (let i = 0; i < haystack.length && needleIndex < needle.length; i++) {
    if (haystack[i] === needle[needleIndex]) { needleIndex++; score++ }
  }
  return needleIndex === needle.length ? score : -1
}

const filteredGroups = computed(() => {
  const trimmed = query.value.trim().toLowerCase()
  if (!trimmed) return props.groups
  return props.groups
    .map((group) => ({
      label: group.label,
      items: group.items
        .map((item) => ({ item, score: fuzzyScore(trimmed, `${item.label} ${item.description ?? ''}`.toLowerCase()) }))
        .filter((entry) => entry.score !== -1)
        .sort((a, b) => b.score - a.score)
        .map((entry) => entry.item),
    }))
    .filter((group) => group.items.length)
})
const flatItems = computed(() => filteredGroups.value.flatMap((group) => group.items))

watch(query, () => { highlightedIndex.value = 0 })
watch(open, async (isOpen) => {
  if (!isOpen) return
  query.value = ''
  highlightedIndex.value = Math.max(flatItems.value.findIndex((item) => item.value === modelValue.value), 0)
  await nextTick()
  searchRef.value?.focus()
})

function select(item: SearchableSelectItem) {
  modelValue.value = item.value
  open.value = false
}
function selectHighlighted() {
  const item = flatItems.value[highlightedIndex.value]
  if (item) select(item)
}
function moveHighlight(delta: number) {
  if (!flatItems.value.length) return
  highlightedIndex.value = Math.min(Math.max(highlightedIndex.value + delta, 0), flatItems.value.length - 1)
}
function handleClickOutside(event: MouseEvent) {
  if (rootRef.value && !rootRef.value.contains(event.target as Node)) open.value = false
}
onMounted(() => window.addEventListener('mousedown', handleClickOutside))
onBeforeUnmount(() => window.removeEventListener('mousedown', handleClickOutside))
</script>

<template>
  <div ref="rootRef" class="relative">
    <button type="button" class="focus-ring flex w-full items-center justify-between gap-2 rounded-xl border p-3 text-left text-sm" @click="open = !open">
      <span class="min-w-0 flex-1">
        <template v-if="selectedItem">
          <strong class="block truncate">{{ selectedItem.label }}</strong>
          <span v-if="selectedItem.description" class="mt-1 block truncate text-xs text-[#737a75]">{{ selectedItem.description }}</span>
        </template>
        <span v-else class="text-[#9aa096]">{{ placeholder ?? 'Auswählen…' }}</span>
      </span>
      <ChevronDown :size="16" class="shrink-0 text-[#9aa096] transition-transform" :class="open ? 'rotate-180' : ''" />
    </button>
    <div v-if="open" class="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border bg-[#fcfcf8] shadow-lg">
      <input
        ref="searchRef" v-model="query" type="text" placeholder="Suchen…"
        class="focus-ring w-full border-b p-3 text-sm"
        @keydown.down.prevent="moveHighlight(1)"
        @keydown.up.prevent="moveHighlight(-1)"
        @keydown.enter.prevent="selectHighlighted"
        @keydown.esc="open = false"
      />
      <div class="max-h-72 overflow-y-auto p-1">
        <template v-if="flatItems.length">
          <div v-for="group in filteredGroups" :key="group.label" class="mb-1">
            <p class="px-2 py-1 text-[11px] font-semibold text-[#9aa096]">{{ group.label }}</p>
            <button
              v-for="item in group.items" :key="item.value" type="button"
              class="block w-full rounded-lg p-2 text-left text-sm"
              :class="[item.value === modelValue ? 'bg-[#eff4e6]' : '', flatItems.indexOf(item) === highlightedIndex ? 'ring-1 ring-forest' : '']"
              @mouseenter="highlightedIndex = flatItems.indexOf(item)"
              @click="select(item)"
            >
              <strong>{{ item.label }}</strong>
              <span v-if="item.description" class="mt-0.5 block text-xs text-[#737a75]">{{ item.description }}</span>
            </button>
          </div>
        </template>
        <p v-else class="p-3 text-xs text-[#9aa096]">Keine Treffer.</p>
      </div>
    </div>
  </div>
</template>
