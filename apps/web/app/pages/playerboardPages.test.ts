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

    expect(functionBody(page, 'load')).toContain('if (loadRun === latestLoad) entries.value = loaded')
    const consents = functionBody(page, 'loadConsents')
    expect(consents.indexOf('if (loadRun !== latestConsentLoad) return')).toBeGreaterThan(-1)
    expect(consents.indexOf('if (loadRun !== latestConsentLoad) return')).toBeLessThan(consents.indexOf('playersWithoutConsent.value = roster'))
  })

  it('uebernimmt den Saisonanfang der Spiele erst nach der Pruefung auf eine neuere Anfrage', () => {
    const load = functionBody(read('playerboard/spiele.vue'), 'load')

    expect(load).not.toContain('seasonFrom.value = await')
    expect(load.indexOf('if (request !== latestRequest) return')).toBeLessThan(load.indexOf('seasonFrom.value = loadedSeasonFrom'))
  })
})
