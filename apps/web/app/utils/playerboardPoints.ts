// Paket 052, PR 3: Logik der mobilen Punkteeingabe, getrennt von der Komponente testbar.

export type PointKey = `${string}:${string}`

/** Verbindet Spieler- und Kategorie-ID zum Schluessel einer Punktezelle. */
export function pointKey(playerId: string, categoryId: string): PointKey {
  return `${playerId}:${categoryId}`
}

// Plus/Minus am Platzrand: ein leeres Feld startet bei 0 (bzw. an der naechsten Grenze, wenn 0
// ausserhalb liegt), damit der erste Tipp auf "+" eine 1 ergibt und nicht den Minimalwert.
export function stepPoint(current: number | null, delta: number, min: number, max: number): number {
  const base = current ?? Math.min(max, Math.max(min, 0))
  return Math.min(max, Math.max(min, base + delta))
}

// Eingabe aus dem Zahlenfeld: '' loescht, sonst ganze Zahl im Bereich. Alles andere ist ungueltig
// und wird nicht gespeichert.
export function parsePointInput(raw: string, min: number, max: number): { ok: true; value: number | null } | { ok: false } {
  const trimmed = raw.trim()
  if (trimmed === '') return { ok: true, value: null }
  if (!/^-?\d+$/.test(trimmed)) return { ok: false }
  const value = Number(trimmed)
  return value >= min && value <= max ? { ok: true, value } : { ok: false }
}

export type PointSaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error'

export interface PointSaveQueue {
  // Markiert eine Zelle als geaendert und plant das Speichern (entprellt).
  change(key: PointKey): void
  // Speichert sofort alles Offene, z. B. beim Verlassen der Seite. Wirft nicht.
  flush(): Promise<void>
  hasUnsaved(): boolean
  dispose(): void
}

// Sammelt Aenderungen und speichert sie in einem Aufruf (PUT .../points, alles oder nichts).
// Waehrend ein Speichern laeuft, entstehende Aenderungen gehen im naechsten Aufruf mit. Scheitert
// ein Aufruf, bleiben seine Zellen offen und werden beim naechsten Versuch erneut gesendet.
export function createPointSaveQueue(options: {
  read: (key: PointKey) => number | null
  save: (entries: { key: PointKey; value: number | null }[]) => Promise<void>
  onState: (state: PointSaveState, error?: unknown) => void
  delayMs?: number
  setTimer?: (callback: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}): PointSaveQueue {
  const delayMs = options.delayMs ?? 700
  const setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms))
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  const dirty = new Set<PointKey>()
  let timer: unknown = null
  let running: Promise<void> | null = null
  let disposed = false

  /** Setzt die Wartezeit zurueck und plant das Speichern der offenen Zellen. */
  function schedule() {
    if (timer !== null) clearTimer(timer)
    timer = setTimer(() => {
      timer = null
      void flush()
    }, delayMs)
  }

  /** Speichert offene Zellen in Folge; bei einem Fehler bleiben sie fuer den naechsten Versuch offen. */
  async function run(): Promise<void> {
    while (dirty.size > 0 && !disposed) {
      const keys = [...dirty]
      dirty.clear()
      options.onState('saving')
      try {
        await options.save(keys.map((key) => ({ key, value: options.read(key) })))
      } catch (error) {
        for (const key of keys) dirty.add(key)
        options.onState('error', error)
        return
      }
    }
    if (!disposed) options.onState(dirty.size > 0 ? 'pending' : 'saved')
  }

  /** Bricht den Timer ab, wartet auf laufendes Speichern und sendet danach noch offene Zellen. */
  async function flush(): Promise<void> {
    if (timer !== null) {
      clearTimer(timer)
      timer = null
    }
    if (running) {
      await running
      if (dirty.size === 0) return
    }
    running = run().finally(() => { running = null })
    await running
  }

  return {
    change(key) {
      dirty.add(key)
      options.onState('pending')
      schedule()
    },
    flush,
    hasUnsaved: () => dirty.size > 0 || running !== null,
    dispose() {
      disposed = true
      if (timer !== null) clearTimer(timer)
    },
  }
}
