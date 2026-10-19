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

  it('prueft die Onboarding-Antwort am Vertrag statt sie nur zu casten', () => {
    const page = readFileSync(join(PAGES_DIR, 'index.vue'), 'utf8')

    expect(page).not.toContain('$fetch<{ completedSteps: string[] }>')
    expect(page).toContain('.then((response) => OnboardingStateSchema.parse(response))')
  })

  it('zeigt in "Aktuelle Beitraege" die geladenen Beitraege statt eines festen Leertexts', () => {
    const page = readFileSync(join(PAGES_DIR, 'index.vue'), 'utf8')

    // Die Karte behauptete immer "Es liegen noch keine Beitraege vor", auch bei vorhandenen.
    expect(page).not.toContain('Diese Liste befüllt sich, sobald echte Beiträge')
    expect(page).toContain("recentPosts.value = posts.slice(0, RECENT_POSTS_LIMIT)")
    expect(page).toContain(".order('created_at', { ascending: false })")
    expect(page).toContain('v-for="post in recentPosts"')
    expect(page).toContain('v-else-if="!loadingDashboard"')
  })
})
