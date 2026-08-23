import type { Ref } from 'vue'

export interface PageSaveFabAction {
  label: string
  save: () => void | Promise<void>
  saving: Ref<boolean>
  disabled?: Ref<boolean>
}

// Eine Seite registriert ihre eine primäre Speicheraktion; das Standardlayout zeigt sie als FAB.
// Lokale Formularaktionen (z. B. "Prüfer hinzufügen") werden bewusst nicht als Seitenaktion
// registriert, weil sie keinen vollständigen Seitenentwurf speichern.
export function usePageSaveFab(action: PageSaveFabAction) {
  const activeAction = useState<PageSaveFabAction | null>('vf-page-save-fab', () => null)

  onMounted(() => {
    activeAction.value = action
  })
  onBeforeUnmount(() => {
    if (activeAction.value === action) activeAction.value = null
  })

  return activeAction
}

export function useActivePageSaveFab() {
  return useState<PageSaveFabAction | null>('vf-page-save-fab', () => null)
}
