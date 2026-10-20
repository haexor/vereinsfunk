import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGES_DIR = join(import.meta.dirname, '.')

// Warteschleife und Antwortreihenfolge der Integrationsseite -- ohne Seiten-Mount nur im Quelltext
// festzuhalten, dieselbe Bauart wie targetPlatformDefaults.test.ts.
describe('Integrationen', () => {
  it('wartet auf einen HTTP-Abgleich nur befristet und nicht ueber das Verlassen der Seite hinaus', () => {
    const page = readFileSync(join(PAGES_DIR, 'integrationen.vue'), 'utf8')

    expect(page).not.toContain('while (historySourceId.value === source.id) {')
    expect(page).toContain('while (!unmounted && historySourceId.value === source.id && Date.now() < deadline) {')
    expect(page).toContain('onUnmounted(() => { unmounted = true })')
    expect(page).toContain('if (unmounted) return\n      await load()')
  })

  it('zeigt Verlauf und Konflikte nur aus dem zuletzt gestarteten Abruf', () => {
    const page = readFileSync(join(PAGES_DIR, 'integrationen.vue'), 'utf8')

    expect(page).toContain('if (run !== historyLoadRun) return false\n    historyRuns.value = runs')
    expect(page).toContain('if (run === conflictsLoadRun) conflictItems.value = conflicts')
  })
})
