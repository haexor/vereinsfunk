<script setup lang="ts">
import { AlertTriangle } from '@lucide/vue'
import { BRAND_LOCKABLE_FIELDS, meetsMinimumContrast, MINIMUM_AA_CONTRAST, type ResolvedBrand } from '@vereinsfunk/domain'
import type { ActiveScopeLevel } from '../composables/useActiveScope'
import type { BrandLevelOverride, BrandOrganizationState } from '../composables/useBrandAssets'

type ColorField = 'primaryColor' | 'accentColor'
export type OrganizationColorPatch = Partial<Pick<BrandOrganizationState, ColorField | 'allowDepartmentOverrides' | 'lockedFields'>>
export type DepartmentColorPatch = Partial<Pick<BrandLevelOverride, ColorField | 'allowTeamOverrides'>>

// Farbrollen der aktiven Ebene samt Sperren und Kontrastpruefung. Aenderungen gehen als Patch an
// die Seite, der der Formularzustand gehoert (useBrandPageData).
const props = defineProps<{
  level: ActiveScopeLevel
  organization: BrandOrganizationState
  departmentOverride: BrandLevelOverride | null
  locked: ReadonlySet<string>
  resolved: ResolvedBrand
}>()
const emit = defineEmits<{
  'update-organization': [patch: OrganizationColorPatch]
  'update-department': [patch: DepartmentColorPatch]
}>()

// Genau BRAND_LOCKABLE_FIELDS aus packages/domain, nur mit deutschem Etikett: eine Sperre wirkt
// ausschliesslich auf Felder, die eine Abteilung/Mannschaft ueberhaupt selbst fuehren kann.
const LOCKABLE_FIELD_LABELS: Readonly<Record<string, string>> = {
  primaryColor: 'Primärfarbe',
  accentColor: 'Akzentfarbe',
  logoAssetId: 'Logo',
  websiteUrl: 'Website-Adresse',
  displayFontAssetId: 'Eigene Überschriften-Schrift',
  bodyFontAssetId: 'Eigene Fließtext-Schrift',
}
const LOCKABLE_FIELDS = BRAND_LOCKABLE_FIELDS.map((key) => ({
  key,
  label: LOCKABLE_FIELD_LABELS[key]!,
}))
const COLOR_FIELDS: readonly { key: ColorField; label: string }[] = [
  { key: 'primaryColor', label: 'Primärfarbe' },
  { key: 'accentColor', label: 'Akzentfarbe' },
]

const contrastChecks = computed(() => [
  {
    label: 'Text auf Hintergrund',
    ...meetsMinimumContrast(props.resolved.textColor, props.resolved.backgroundColor),
  },
  {
    label: 'Auf-Primär-Text auf Primärfarbe',
    ...meetsMinimumContrast(props.resolved.onPrimaryColor, props.resolved.primaryColor),
  },
  {
    label: 'Text auf Akzentfarbe',
    ...meetsMinimumContrast(props.resolved.textColor, props.resolved.accentColor),
  },
])

function inputValue(event: Event): string {
  return (event.target as HTMLInputElement).value
}
function inputChecked(event: Event): boolean {
  return (event.target as HTMLInputElement).checked
}
function setOrganizationColor(field: ColorField, value: string) {
  emit('update-organization', field === 'primaryColor' ? { primaryColor: value } : { accentColor: value })
}
function setDepartmentColor(field: ColorField, value: string | null) {
  emit('update-department', field === 'primaryColor' ? { primaryColor: value } : { accentColor: value })
}
function toggleLockedField(field: string, locked: boolean) {
  const others = props.organization.lockedFields.filter((entry) => entry !== field)
  emit('update-organization', { lockedFields: locked ? [...others, field] : others })
}
</script>

<template>
  <section class="card p-6">
    <h2 class="font-display text-base font-bold">Farbrollen</h2>
    <template v-if="level === 'organization'">
      <div class="mt-5 grid grid-cols-2 gap-4">
        <label v-for="field in COLOR_FIELDS" :key="field.key">
          <span class="mb-2 flex items-center gap-1 text-xs font-semibold">
            {{ field.label }}
            <span
              v-if="organization.lockedFields.includes(field.key)"
              class="rounded-full bg-[#eef1ea] px-1.5 py-0.5 text-[9px] text-[#9aa096]"
              >gesperrt für Abteilungen</span
            >
          </span>
          <div
            class="flex items-center gap-2 rounded-xl border border-[#dfe0d9] bg-white p-2"
          >
            <input
              :value="organization[field.key]"
              type="color"
              class="h-8 w-8 border-0 bg-transparent"
              @input="setOrganizationColor(field.key, inputValue($event))"
            />
            <span class="text-xs">{{ organization[field.key] }}</span>
          </div>
        </label>
      </div>
      <label class="mt-4 flex items-center gap-2 text-xs">
        <input
          :checked="organization.allowDepartmentOverrides"
          type="checkbox"
          class="h-4 w-4 accent-[#163a2c]"
          @change="emit('update-organization', { allowDepartmentOverrides: inputChecked($event) })"
        />
        Abteilungen dürfen eigenes Branding führen
      </label>
      <div v-if="organization.allowDepartmentOverrides" class="mt-3">
        <p class="mb-2 text-[11px] font-semibold text-[#7b827d]">
          Felder für Abteilungen sperren:
        </p>
        <label
          v-for="field in LOCKABLE_FIELDS"
          :key="field.key"
          class="mr-3 inline-flex items-center gap-1.5 text-[11px]"
        >
          <input
            type="checkbox"
            class="h-4 w-4 accent-[#163a2c]"
            :checked="organization.lockedFields.includes(field.key)"
            @change="toggleLockedField(field.key, inputChecked($event))"
          />
          {{ field.label }}
        </label>
      </div>
    </template>
    <template v-else-if="departmentOverride && level === 'department'">
      <p class="mt-2 text-xs text-[#7a817c]">
        Leer lassen, um die Vereinsfarbe zu übernehmen.
      </p>
      <div class="mt-4 grid grid-cols-2 gap-4">
        <label v-for="field in COLOR_FIELDS" :key="field.key">
          <span class="mb-2 flex items-center gap-1 text-xs font-semibold">
            {{ field.label }}
            <span
              v-if="locked.has(field.key)"
              class="rounded-full bg-[#eef1ea] px-1.5 py-0.5 text-[9px] text-[#9aa096]"
              >vom Verein gesperrt</span
            >
          </span>
          <div
            class="flex items-center gap-2 rounded-xl border border-[#dfe0d9] bg-white p-2"
            :class="locked.has(field.key) && 'opacity-50'"
          >
            <input
              :value="departmentOverride[field.key] ?? resolved[field.key]"
              type="color"
              class="h-8 w-8 border-0 bg-transparent"
              :disabled="locked.has(field.key)"
              @input="setDepartmentColor(field.key, inputValue($event))"
            />
            <span class="text-xs">{{
              departmentOverride[field.key] ?? `geerbt: ${resolved[field.key]}`
            }}</span>
            <button
              v-if="departmentOverride[field.key]"
              class="focus-ring ml-auto text-[10px] underline"
              @click="setDepartmentColor(field.key, null)"
            >
              erben
            </button>
          </div>
        </label>
      </div>
      <label class="mt-4 flex items-center gap-2 text-xs">
        <input
          :checked="departmentOverride.allowTeamOverrides"
          type="checkbox"
          class="h-4 w-4 accent-[#163a2c]"
          @change="emit('update-department', { allowTeamOverrides: inputChecked($event) })"
        />
        Mannschaften dürfen eigenes Branding führen
      </label>
    </template>
    <div class="mt-5 space-y-1.5 border-t border-[#eceee7] pt-4">
      <p class="mb-1 text-[11px] font-semibold text-[#7b827d]">
        Lesbarkeit (WCAG-AA-Kontrast, mind. {{ MINIMUM_AA_CONTRAST }}:1)
      </p>
      <div
        v-for="check in contrastChecks"
        :key="check.label"
        class="flex items-center justify-between text-[11px]"
        :title="`Kontrastverhältnis ${check.ratio}:1 — WCAG AA verlangt mindestens ${MINIMUM_AA_CONTRAST}:1`"
      >
        <span class="text-[#7b827d]">{{ check.label }}</span>
        <span
          class="flex items-center gap-1 font-semibold"
          :class="check.meetsAA ? 'text-emerald-700' : 'text-amber-800'"
        >
          <AlertTriangle v-if="!check.meetsAA" :size="12" /> {{ check.ratio }}:1 ·
          {{ check.meetsAA ? 'gut lesbar' : 'schwer lesbar' }}
        </span>
      </div>
    </div>
  </section>
</template>
