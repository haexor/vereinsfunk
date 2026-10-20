import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGES_DIR = join(import.meta.dirname, '.')

// Zustand, der einen Vereinswechsel ueberlebte -- ohne Seiten-Mount nur im Quelltext festzuhalten,
// dieselbe Bauart wie targetPlatformDefaults.test.ts.
describe('Vereinswechsel', () => {
  it('setzt die Markenfarben der Bildkomposition ohne eigene Markenzeile auf die Vorgaben zurueck', () => {
    const page = readFileSync(join(PAGES_DIR, 'bildkomposition.vue'), 'utf8')

    expect(page).not.toContain('if (orgBrandResult.data) {')
    expect(page).toContain('orgColors.primaryColor = orgBrandResult.data?.primary_color ?? DEFAULT_ORG_COLORS.primaryColor')
    expect(page).toContain('orgColors.accentColor = orgBrandResult.data?.accent_color ?? DEFAULT_ORG_COLORS.accentColor')
  })

  it('verwirft im Integrationsformular eine Abteilung des vorigen Vereins auch bei vereinsweitem Recht', () => {
    const page = readFileSync(join(PAGES_DIR, 'integrationen.vue'), 'utf8')

    expect(page).not.toContain('if (canManageOrgWide.value) return\n')
    expect(page).toContain('const stillValid = current ? list.some((department) => department.id === current) : canManageOrgWide.value')
    expect(page).toContain("if (!stillValid) createForm.value.departmentId = canManageOrgWide.value ? '' : list[0]?.id ?? ''")
  })
})
