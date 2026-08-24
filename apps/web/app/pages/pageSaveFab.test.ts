import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const appDirectory = join(import.meta.dirname, '..')

describe('Seitenaktions-FAB', () => {
  it('behält Aktionen als roh markiert, damit sie beim Verlassen der Seite entfernt werden', () => {
    const composable = readFileSync(join(appDirectory, 'composables/usePageSaveFab.ts'), 'utf8')

    expect(composable).toContain('const registeredAction = markRaw(action)')
    expect(composable).toContain('activeAction.value === registeredAction')
  })

  it('zeigt im Eingabeschritt der Textwerkstatt die Kandidatenerzeugung als primäre Aktion', () => {
    const page = readFileSync(join(appDirectory, 'pages/erstellen.vue'), 'utf8')
    const fab = readFileSync(join(appDirectory, 'components/PageSaveFab.vue'), 'utf8')

    expect(page).toContain("usePageSaveFab({ label: 'Textkandidaten erzeugen', save: createCandidate")
    expect(page).toContain('visible: showCreateCandidateFab')
    expect(page).toContain('const showCreateCandidateFab = computed(() => !sessionId.value)')
    expect(page).not.toContain('@click="createCandidate"')
    expect(fab).toContain('v-if="action && isVisible"')
  })
})
