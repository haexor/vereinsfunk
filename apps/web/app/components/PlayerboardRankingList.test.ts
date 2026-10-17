import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Das Web-Paket mountet keine Komponenten (kein DOM-Werkzeug); wie in appPageLayout.test.ts prueft
// ein Quelltext-Test die Struktur. Ob ein Name ein Link wird, entscheidet personProfilePath
// (utils/personProfile.test.ts); die interne Rangliste setzt personId, die oeffentliche nie.
const source = readFileSync(join(import.meta.dirname, 'PlayerboardRankingList.vue'), 'utf8')

describe('PlayerboardRankingList', () => {
  it('shows the name as a profile link fed by the item person id', () => {
    expect(source).toContain('<PersonLink :person-id="item.personId"')
  })

  it('never puts the link inside the expand button, since a link in a button is invalid and not keyboard-safe', () => {
    const buttons = source.match(/<button\b[\s\S]*?(?:\/>|<\/button>)/g) ?? []
    expect(buttons.length).toBeGreaterThan(0)
    for (const button of buttons) expect(button).not.toContain('PersonLink')
  })

  it('keeps expanding with its own button that is disabled without categories', () => {
    expect(source).toContain(':aria-expanded="expanded === item.key"')
    expect(source).toContain(':disabled="item.categories.length === 0"')
    expect(source).toContain('@click="toggle(item.key)"')
  })

  it('lets clicks on the row reach the expand button, but not on the name link', () => {
    expect(source).toContain('pointer-events-none')
    expect(source).toContain('class="pointer-events-auto"')
  })
})
