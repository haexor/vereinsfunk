import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGES_DIR = join(import.meta.dirname, '.')

// Zwei Funde aus dem Review von Paket 044 PR 1. Beide sind Reihenfolge- bzw. Herkunftsfragen, die
// sich nur im Quelltext festhalten lassen -- dieselbe Bauart wie channelComposition.test.ts.
describe('Zielplattform-Vorgaben', () => {
  it('reicht dem Umschalter nicht die eigene effective-Auflösung als Vorgabe von oben', () => {
    const page = readFileSync(join(PAGES_DIR, 'einstellungen/index.vue'), 'utf8')

    // `effective` einer Ebene rechnet ihre EIGENE Zeile mit: als „Vorgabe der übergeordneten Ebene"
    // durchgereicht, zeigte der Hinweis beim Umschalten auf „geerbt" genau den Wert, den der
    // Betreiber gerade abwählt -- und auf Vereinsebene eine übergeordnete Ebene, die es nicht gibt.
    expect(page).not.toContain(':effective-value="selectedEntry.effective.defaultTargetPlatforms')
    expect(page).toContain(':inherited-value="inheritedTargetPlatforms"')
    expect(page).toContain("if (entry.scope === 'organization') return []")
    // Die Vorgabe von oben kommt aus dem Eintrag der übergeordneten Ebene, nicht aus dem eigenen.
    expect(page).toContain("entries.value.find((item) => item.scope === 'department' && item.scopeId === selectedDepartmentId.value)")
    expect(page).toContain("entries.value.find((item) => item.scope === 'organization')")
    expect(page).toContain('parent ? parent.effective.defaultTargetPlatforms ?? [] : undefined')
  })

  it('lädt Verfügbarkeit und Stilprofile innerhalb der restoringDraft-Klammer', () => {
    const page = readFileSync(join(PAGES_DIR, 'erstellen.vue'), 'utf8')

    // persistDraft hängt an einem Watcher mit flush: 'sync'. loadPlatformAvailability() schreibt
    // selectedPlatforms (seit diesem Paket die Vorgabe der Ebene, vorher alle verfügbaren) -- ohne
    // die Klammer lief persistDraft damit noch VOR restoreDraft()/loadDraftFromPost() und legte den
    // leeren Formularzustand über den gespeicherten bzw. wiedereroeffneten Entwurf: nach jedem
    // Neuladen war das getippte Quellmaterial still verloren.
    expect(page.replace(/\s+/g, ' ')).toContain(
      "restoringDraft = true await Promise.all([loadProfiles(), loadPlatformAvailability(), loadCapabilities()]) const resumePostId = typeof route.query.postId === 'string' ? route.query.postId : null if (resumePostId) await loadDraftFromPost(resumePostId) else restoreDraft() restoringDraft = false",
    )
  })
})
