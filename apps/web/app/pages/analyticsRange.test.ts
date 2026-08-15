import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGES_DIR = join(import.meta.dirname, '.')

describe('analytics date range', () => {
  it('maps the default 30-day preset to a complete inclusive date range', () => {
    const page = readFileSync(join(PAGES_DIR, 'auswertung.vue'), 'utf8')

    expect(page).toContain("const rangePreset = ref<RangePreset>('30d')")
    expect(page).toContain("if (rangePreset.value === '30d') return { from: addDaysToKey(todayKey, -29), to: todayKey }")
  })
})
