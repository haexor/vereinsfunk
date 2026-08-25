import type { ActiveScope } from '~/composables/useScope'

// Der Verein-/Abteilungswechsel in der Sidebar setzt `active` direkt, ohne erneut useScope()
// aufzurufen. Dieser Plugin ist der einzige Ort, der solche Aenderungen ins Cookie spiegelt -
// einmal pro App-Instanz registriert, unabhaengig davon, wie oft useScope() aufgerufen wird.
export default defineNuxtPlugin(() => {
  const active = useState<ActiveScope | null>('vf-scope', () => null)
  const remembered = useCookie<ActiveScope | null>('vf-scope-cookie', { default: () => null })

  watch(active, (value) => {
    remembered.value = value
  })
})
