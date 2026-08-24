import { markRaw, type Component, type Ref } from 'vue'

export interface PageSaveFabAction {
  label: string
  save: () => void | Promise<void>
  saving: Ref<boolean>
  disabled?: Ref<boolean>
  visible?: Ref<boolean>
  icon?: Component
  savingLabel?: string
}

// Eine Seite registriert ihre eine primäre Speicheraktion; das Standardlayout zeigt sie als FAB.
// Lokale Formularaktionen (z. B. "Prüfer hinzufügen") werden bewusst nicht als Seitenaktion
// registriert, weil sie keinen vollständigen Seitenentwurf speichern.
export function usePageSaveFab(action: PageSaveFabAction) {
  const activeAction = useState<PageSaveFabAction | null>('vf-page-save-fab', () => null)
  // useState macht zugewiesene Objekte reaktiv. Die Referenzen innerhalb der Aktion (saving,
  // disabled usw.) muessen aber echte Refs bleiben; ausserdem muss die Abmeldung dieselbe Aktion
  // wiedererkennen. markRaw verhindert beides und verhindert damit, dass eine alte Seitenaktion
  // nach der Navigation als FAB stehen bleibt.
  const registeredAction = markRaw(action)

  onMounted(() => {
    activeAction.value = registeredAction
  })
  onBeforeUnmount(() => {
    if (activeAction.value === registeredAction) activeAction.value = null
  })

  return activeAction
}

export function useActivePageSaveFab() {
  return useState<PageSaveFabAction | null>('vf-page-save-fab', () => null)
}
