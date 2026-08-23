// Branddaten liegen in Supabase und werden ausserhalb des Session-Scopes gepflegt. Diese kleine
// lokale Revision informiert die dauerhafte App-Shell nach einem Speichern ueber eine neue Farbe
// oder ein neues aktives Logo, ohne die gesamte Session erneut laden zu muessen.
export function useBrandRevision() {
  const revision = useState<number>('vf-brand-revision', () => 0)

  function refreshBrandRevision() {
    revision.value += 1
  }

  return { revision: readonly(revision), refreshBrandRevision }
}
