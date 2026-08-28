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

  it('zeigt die Kandidatenerzeugung vor der ersten Sitzung, nach Fehlern und bei einem Stilwechsel als primäre Aktion', () => {
    const page = readFileSync(join(appDirectory, 'pages/erstellen.vue'), 'utf8')
    const fab = readFileSync(join(appDirectory, 'components/PageSaveFab.vue'), 'utf8')

    expect(page).toContain("usePageSaveFab({ label: 'Textkandidaten erzeugen', save: createCandidate")
    expect(page).toContain('visible: showCreateCandidateFab')
    expect(page).toContain("const DEFAULT_TEXT_WORKSHOP_PROFILE = 'lebendig_sportlich'")
    expect(page).toContain('const selectedProfile = ref<string>(DEFAULT_TEXT_WORKSHOP_PROFILE)')
    expect(page).toContain('const showCreateCandidateFab = computed(() => (!sessionId.value && !candidate.value) || candidate.value?.status === \'failed\' || (candidateFinished.value && sessionProfile.value !== null && selectedProfile.value !== sessionProfile.value))')
    expect(page).not.toContain('@click="createCandidate"')
    expect(fab).toContain('v-if="action && isVisible"')
  })

  it('haelt das Eingabeformular sichtbar, auch waehrend/nach einer Kandidatenerzeugung', () => {
    const page = readFileSync(join(appDirectory, 'pages/erstellen.vue'), 'utf8')

    // Fehlschlaegt eine Generierung, muss ein Weg zurueck ins Formular bestehen -- vorher blendete
    // v-if="!sessionId" das Formular aus und liess nur die Sackgassen-Fehlermeldung stehen.
    expect(page).not.toContain('<section v-if="!sessionId"')
    expect(page).toContain('<section class="card grid gap-5 p-5 sm:p-7">')
    expect(page).toContain('<section v-if="sessionId" class="card mt-6 p-5 sm:p-7">')
  })
})
