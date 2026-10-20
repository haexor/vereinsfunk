import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGES_DIR = join(import.meta.dirname, '.')

function functionBody(source: string, name: string): string {
  return source.match(new RegExp(`async function ${name}\\([^)]*\\)[\\s\\S]*?\\n}`))?.[0] ?? ''
}

// Reihenfolgefragen im Betreiberbereich, die sich nur im Quelltext festhalten lassen -- dieselbe
// Bauart wie targetPlatformDefaults.test.ts.
describe('Betreiberformulare', () => {
  it('setzt Folgefelder des LLM-Formulars nur bei einer Aenderung durch die Person zurueck', () => {
    const page = readFileSync(join(PAGES_DIR, 'plattform-admin/llm.vue'), 'utf8')

    // Watcher liefen auch nach editProvider() los: das Modell war danach leer und eine eigene
    // Proxy-URL durch das erste Preset des Protokolls ersetzt.
    expect(page).not.toContain('watch(() => newProvider.protocol')
    expect(page).not.toContain('watch(() => newProvider.baseUrl')
    expect(page).toContain('<Select v-model="protocolModel">')
    expect(page).toContain('v-model="baseUrlModel"')
    expect(page).toContain('baseUrlModel.value = preset?.baseUrl ?? \'\'')
  })

  it('zeigt die Fehlermeldung eines Einstellungs-Speicherns erst nach dem Neuladen an', () => {
    const page = readFileSync(join(PAGES_DIR, 'plattform-admin/einstellungen.vue'), 'utf8')

    // load() leert errorMessage -- vorher gesetzt, war die 409-Erklaerung nie zu sehen.
    for (const name of ['savePublishingEnabled', 'saveAgentLlmProvider']) {
      const body = functionBody(page, name)
      const catchBlock = body.slice(body.indexOf('} catch'))
      expect(catchBlock.indexOf('await load()')).toBeGreaterThan(-1)
      expect(catchBlock.indexOf('await load()')).toBeLessThan(catchBlock.indexOf('errorMessage.value ='))
    }
  })
})
