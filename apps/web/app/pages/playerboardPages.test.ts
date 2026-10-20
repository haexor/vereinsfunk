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
})
