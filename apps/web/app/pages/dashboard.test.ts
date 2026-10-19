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
})
