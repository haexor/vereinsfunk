import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGES_DIR = join(import.meta.dirname, '.')

// Gleiche Bauart wie apiClientMigration.test.ts, fuer die Vereins-, Betreiber- und oeffentlichen
// Seiten: Header, Basis-URL, Fehlercodes und Antwortpruefung laufen nur noch ueber useApiClient().
const PAGES = [
  'mannschaft/[orgSlug]/[teamSlug].vue',
  'onboarding/index.vue',
  'plattform-admin-einladung.vue',
  'plattform-admin/admins.vue',
  'plattform-admin/einstellungen.vue',
  'plattform-admin/index.vue',
  'plattform-admin/llm.vue',
  'plattform-admin/vereine/[id].vue',
  'plattform-admin/vision-vergleich.vue',
  'profil.vue',
  'struktur.vue',
  'verzeichnis.vue',
]

describe('API-Client auf den Vereins- und Betreiberseiten', () => {
  for (const page of PAGES) {
    it(`${page} fragt die API nur ueber useApiClient an`, () => {
      const source = readFileSync(join(PAGES_DIR, page), 'utf8')

      expect(source).toContain('useApiClient()')
      expect(source).not.toContain('useAuthHeader()')
      expect(source).not.toContain('config.public.apiBase')
      expect(source).not.toContain('$fetch')
      // Fehlercodes kommen aus ApiRequestError.code statt aus einem eigenen Cast auf data.error.
      expect(source).not.toContain('?.data?.error')
    })
  }

  it('ruft die oeffentliche Mannschaftsseite ohne Anmeldung ab', () => {
    const source = readFileSync(join(PAGES_DIR, 'mannschaft/[orgSlug]/[teamSlug].vue'), 'utf8')

    expect(source.match(/api\.request\(/g)?.length).toBe(source.match(/authenticate: false/g)?.length)
  })
})
