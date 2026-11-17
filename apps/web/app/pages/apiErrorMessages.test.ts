import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const APP_DIR = join(import.meta.dirname, '..')

function read(path: string): string {
  return readFileSync(join(APP_DIR, path), 'utf8')
}

// Fehlercodes, die die API eigens fuer diese Faelle liefert, bekommen eine Erklaerung statt der
// allgemeinen Meldung -- dieselbe Bauart wie targetPlatformDefaults.test.ts.
describe('Meldungen zu fachlichen API-Fehlern', () => {
  it('raet bei einem verwendeten LLM-Provider zum Deaktivieren statt Loeschen', () => {
    const page = read('pages/plattform-admin/llm.vue')

    expect(page).toContain("error.code === 'llm_provider_in_use'")
    expect(page).toContain('Deaktiviere ihn stattdessen.')
  })

  it('nennt einen vergebenen Persona-Slug', () => {
    const page = read('pages/plattform-admin/personas.vue')

    expect(page).toContain("error.code === 'slug_taken'")
    expect(page).toContain('Dieser Slug ist bereits vergeben.')
  })

  it('aktualisiert eine veraltete Lizenzkarte auf /marke', () => {
    const composable = read('composables/useBrandAssets.ts')
    const start = composable.indexOf("error.code === 'brand_asset_not_pending_license'")
    const handler = composable.slice(start)

    expect(start).toBeGreaterThan(-1)
    expect(handler.indexOf('wartet nicht mehr auf eine Lizenzbestätigung')).toBeGreaterThan(-1)
    expect(handler.indexOf('wartet nicht mehr auf eine Lizenzbestätigung')).toBeLessThan(handler.indexOf('await reload()'))
  })

  it('erklaert beim Anlegen, Umbenennen und Wiederherstellen eines Teams den vergebenen Namen', () => {
    const page = read('pages/struktur.vue')
    const handlers = ['createTeam', 'renameTeam', 'toggleTeamArchived'].map((name) => {
      const start = page.indexOf(`async function ${name}(`)
      return page.slice(start, page.indexOf('\n}\n', start))
    })

    expect(page).toContain("error.code === 'team_name_taken'")
    expect(page).toContain('In dieser Abteilung gibt es bereits ein aktives Team mit diesem Namen')
    for (const handler of handlers) expect(handler).toContain('teamErrorMessage(error,')
  })
})
