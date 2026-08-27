// Zweiter und dritter Verwendungsort desselben simplen 4s-Polls (erstellen.vue, dann
// vision-vergleich.vue), beide identisch: unfertig anhand des zuletzt geladenen Zustands
// erkennen, seriell pollen, bis ein Endzustand erreicht ist. useBrandWebsiteAnalysis.ts bleibt
// bewusst eigenstaendig -- dort kommen Generation-Fencing, eine Deadline und ein
// Fehlversuchs-Limit dazu, die dieser einfache Fall nicht braucht.
export function usePolling(load: () => Promise<void>, hasUnfinishedWork: () => boolean, intervalMs = 4000) {
  let timer: ReturnType<typeof setTimeout> | undefined

  async function refresh() {
    try {
      await load()
    } finally {
      // Auch nach einem fehlgeschlagenen Refresh weiterpollen, solange der zuletzt bekannte
      // Zustand noch unfertig ist -- sonst bleibt er nach einem einzelnen Aussetzer ohne
      // automatische Wiederholung haengen.
      ensurePolling()
    }
  }

  function ensurePolling() {
    // Aufrufer laden ihren Zustand teils per Top-Level-await, das laeuft auch waehrend SSR --
    // ohne den client-Guard wuerde der Timer serverseitig gestartet, obwohl onUnmounted() dort
    // nie feuert.
    if (!import.meta.client || timer || !hasUnfinishedWork()) return
    timer = setTimeout(async function poll() {
      // Ein einzelner Fehlschlag bleibt still, der naechste Versuch folgt in intervalMs -- ohne
      // den try/catch wuerde eine abgelehnte Promise hier unbehandelt bleiben.
      try { await refresh() } catch { /* naechster Versuch folgt automatisch */ }
      // Erst nach Abschluss des laufenden Requests neu planen statt per setInterval parallel
      // loszuschicken -- sonst koennten Antworten in falscher Reihenfolge eintreffen.
      timer = hasUnfinishedWork() ? setTimeout(poll, intervalMs) : undefined
    }, intervalMs)
  }

  onUnmounted(() => { if (timer) clearTimeout(timer) })

  return { refresh, ensurePolling }
}
