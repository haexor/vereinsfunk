import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGES_DIR = join(import.meta.dirname, '.')

function read(page: string): string {
  return readFileSync(join(PAGES_DIR, page), 'utf8')
}

function functionBody(source: string, name: string): string {
  return source.match(new RegExp(`async function ${name}\\([^)]*\\)[\\s\\S]*?\\n}`))?.[0] ?? ''
}

// Lade- und Reihenfolgefragen der PlayerBoard-Seiten, die sich nur im Quelltext festhalten lassen
// -- dieselbe Bauart wie targetPlatformDefaults.test.ts.
describe('PlayerBoard-Seiten', () => {
  it('verfolgt einen Veo-Abgleich ueber usePolling, auch wenn er beim Oeffnen schon lief', () => {
    const page = read('playerboard/veo.vue')

    // Vorher startete das Polling erst nach einer Aktion, plante nach dem Verlassen der Seite
    // weitere Timeouts und lief bei einem Mannschaftswechsel fuer die alte weiter.
    expect(page).toContain('usePolling(')
    expect(page).not.toContain('setTimeout(')
    expect(page.replace(/\s+/g, ' ')).toContain('await load() watchRun()')
    expect(page.replace(/\s+/g, ' ')).toContain('watch(teamId, async () => { resetLogin() await load() watchRun() })')
  })

  it('verwirft spaete Antworten frueherer Vereine bzw. Mannschaften in den Einstellungen', () => {
    const page = read('playerboard/einstellungen.vue')

    expect(page).toContain('useScopedLoad(() => organizationId.value')
    expect(page).toContain('if (isLatest()) entries.value = loaded')
    const consents = page.slice(page.indexOf('useScopedLoad(() => level.value'))
    expect(consents.indexOf('if (!isLatest()) return')).toBeGreaterThan(-1)
    expect(consents.indexOf('if (!isLatest()) return')).toBeLessThan(consents.indexOf('playersWithoutConsent.value = roster'))
  })

  it('zeigt unter "Saison" ohne Saisonanfang die Meldung statt der zuletzt geladenen Rangliste', () => {
    const page = read('playerboard/rangliste.vue')

    expect(page.replace(/\s+/g, ' ')).toContain(
      "if (period.value === 'season' && seasonLoadError.value) { items.value = [] errorMessage.value = seasonLoadError.value return }",
    )
  })

  it('uebernimmt den Saisonanfang der Spiele erst nach der Pruefung auf eine neuere Anfrage', () => {
    const load = functionBody(read('playerboard/spiele/index.vue'), 'load')

    expect(load).not.toContain('seasonFrom.value = await')
    expect(load.indexOf('if (!isLatest()) return')).toBeGreaterThan(-1)
    expect(load.indexOf('if (!isLatest()) return')).toBeLessThan(load.indexOf('seasonFrom.value = loadedSeasonFrom'))
  })

  it('teilt sich die Zeitraumwahl zwischen Rangliste und Spielen', () => {
    for (const page of ['playerboard/rangliste.vue', 'playerboard/spiele/index.vue']) {
      const source = read(page)
      expect(source).toContain('<PlayerboardPeriodPicker v-model="period" :periods="periods" :season-from="seasonFrom"')
      expect(source).not.toContain('role="radiogroup"')
    }
  })

  it('holt auf der oeffentlichen Seite frische Fotolinks, wenn ein Bild nicht mehr laedt', () => {
    const page = read('mannschaft/[orgSlug]/[teamSlug].vue')

    // Die signierten Links leben fuenf Minuten; ein spaet ins Bild gescrolltes Foto blieb kaputt.
    expect(page).toContain('@error="reloadExpiredPhotos"')
    expect(functionBody(page, 'reloadExpiredPhotos')).toContain('if (photosReloading || Date.now() - photosLoadedAt < PHOTO_RELOAD_MIN_AGE_MS) return')
  })
})
