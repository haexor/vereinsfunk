import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGES_DIR = join(import.meta.dirname, '.')

// Das Dashboard laedt direkt per Supabase-Client; ohne Seiten-Mount lassen sich Datenherkunft und
// Ladereihenfolge nur im Quelltext festhalten -- dieselbe Bauart wie targetPlatformDefaults.test.ts.
describe('Dashboard', () => {
  it('zaehlt offene Freigaben aus den Beitraegen des gewaehlten Bereichs', () => {
    const page = readFileSync(join(PAGES_DIR, 'index.vue'), 'utf8')

    // approval_requests hat keine Statusspalte und keinen Abteilungsbezug -- freigegebene Beitraege
    // blieben dort gezaehlt, und zwar fuer den ganzen Verein.
    expect(page).not.toContain(".from('approval_requests')")
    expect(page).toContain("openApprovals: posts.filter((post) => post.status === 'awaiting_approval').length")
    expect(page).toContain('status: PostStatus')
  })

  it('protokolliert beim Verwerfen eines Vorschlags nur den Statuscode, nie den FetchError', () => {
    const page = readFileSync(join(PAGES_DIR, 'index.vue'), 'utf8')

    // Der FetchError von ofetch enthaelt options.headers.authorization mit dem Bearer-JWT.
    expect(page).not.toContain('console.error(error)')
    expect(page).toContain("console.error('Anlassvorschlag konnte nicht verworfen werden', (error as { statusCode?: number })?.statusCode)")
  })
})
