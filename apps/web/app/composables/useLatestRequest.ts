import { getCurrentScope, onScopeDispose, watch } from 'vue'

// Schluessel ohne Objektidentitaet: ein neu erzeugtes Objekt mit gleichem Inhalt (etwa ein neu
// gesetzter Arbeitsbereich mit demselben Verein) loeste sonst einen weiteren Ladevorgang aus.
export type LoadKey = string | number | boolean | null | undefined

/**
 * Latest-wins fuer asynchrone Laeufe: begin() startet einen Lauf und liefert dessen Pruefung. Sie
 * bleibt nur wahr, solange kein neuerer Lauf begonnen hat und der besitzende Effekt-Scope (die
 * Komponente) noch lebt -- eine spaete Antwort nach einem Wechsel A -> B (auch A -> B -> A) oder
 * nach dem Verlassen der Seite schreibt dann keinen Zustand mehr.
 */
export function useLatestRequest() {
  let latest = 0
  let disposed = false
  if (getCurrentScope()) onScopeDispose(() => { disposed = true })

  function begin(): () => boolean {
    const run = ++latest
    return () => !disposed && run === latest
  }

  return { begin }
}

/**
 * Laedt bei jedem Wechsel des Schluessels (Verein, Mannschaft ...) neu; Laeufe frueherer
 * Schluessel verfallen ueber isLatest. `ready` ist der erste Lauf, damit Aufrufer ihn per
 * Top-Level-await (SSR) abwarten koennen; reload() laedt nach einer Aenderung fuer den aktuellen
 * Schluessel neu. load faengt seine Fehler selbst ab -- der Watcher wartet auf niemanden.
 */
export function useScopedLoad<K extends LoadKey>(
  key: () => K,
  load: (key: K, isLatest: () => boolean) => Promise<void>,
) {
  const { begin } = useLatestRequest()
  const reload = () => load(key(), begin())
  watch(key, () => { void reload() })
  return { reload, ready: reload() }
}
