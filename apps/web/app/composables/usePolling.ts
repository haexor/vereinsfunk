// Zweiter und dritter Verwendungsort desselben simplen 4s-Polls (erstellen.vue, dann
// vision-vergleich.vue), beide identisch: unfertig anhand des zuletzt geladenen Zustands
// erkennen, seriell pollen, bis ein Endzustand erreicht ist. useBrandWebsiteAnalysis.ts bleibt
// bewusst eigenstaendig -- dort kommen Generation-Fencing, eine Deadline und ein
// Fehlversuchs-Limit dazu, die dieser einfache Fall nicht braucht.
export function usePolling(load: () => Promise<void>, hasUnfinishedWork: () => boolean, intervalMs = 4000) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let cancelled = false
  let inFlight: Promise<void> | undefined

  async function refresh() {
    // Ohne diese Deduplizierung koennte ein direkter Aufruf (z. B. der manuelle
    // "Aktualisieren"-Button) waehrend eines laufenden Poll-Requests einen zweiten parallelen
    // Request ausloesen -- eine langsamere, aeltere Antwort ueberschriebe dann neueren Zustand.
    if (inFlight) return inFlight
    inFlight = (async () => {
      try {
        await load()
      } finally {
        inFlight = undefined
        // Auch nach einem fehlgeschlagenen Refresh weiterpollen, solange der zuletzt bekannte
        // Zustand noch unfertig ist -- sonst bleibt er nach einem einzelnen Aussetzer ohne
        // automatische Wiederholung haengen.
        ensurePolling()
      }
    })()
    return inFlight
  }

  function ensurePolling() {
    // Aufrufer laden ihren Zustand teils per Top-Level-await, das laeuft auch waehrend SSR --
    // ohne den client-Guard wuerde der Timer serverseitig gestartet, obwohl onUnmounted() dort
    // nie feuert.
    if (!import.meta.client || cancelled || timer || !hasUnfinishedWork()) return
    timer = setTimeout(async function poll() {
      // Ein einzelner Fehlschlag bleibt still, der naechste Versuch folgt in intervalMs -- ohne
      // den try/catch wuerde eine abgelehnte Promise hier unbehandelt bleiben.
      try { await refresh() } catch { /* naechster Versuch folgt automatisch */ }
      // onUnmounted() kann den bereits feuernden Timer nicht mehr per clearTimeout abbrechen,
      // waehrend der obige await laeuft -- ohne diese Pruefung wuerde nach dem Verlassen der
      // Seite trotzdem ein neuer Timeout geplant und der Poll liefe unbegrenzt weiter.
      if (cancelled) { timer = undefined; return }
      timer = hasUnfinishedWork() ? setTimeout(poll, intervalMs) : undefined
    }, intervalMs)
  }

  onUnmounted(() => {
    cancelled = true
    if (timer) clearTimeout(timer)
    timer = undefined
  })

  return { refresh, ensurePolling }
}
