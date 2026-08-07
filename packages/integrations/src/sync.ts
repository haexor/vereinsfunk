import type { MatchStrategy, SyncConflict, SyncPlan, SyncPolicy, SyncSkip, SyncUpdate } from './types.js'

function sameFuzzyKey(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function diffFields(
  local: Readonly<Record<string, string | number | boolean | null | undefined>>,
  incoming: Readonly<Record<string, string | number | boolean | null | undefined>>,
): string[] {
  const changed: string[] = []
  for (const field of Object.keys(incoming)) {
    // undefined heisst "die Quelle sagt zu diesem Feld nichts" (MatchStrategy.fieldsOf) und ist
    // kein Unterschied: eine Datei ohne Geburtsjahr-Spalte darf ein lokal gepflegtes Geburtsjahr
    // weder als Aenderung melden noch leeren. Nur ausdrueckliches null loescht. Felder, die es
    // nur lokal gibt, stehen deshalb gar nicht erst zur Debatte.
    const incomingValue = incoming[field]
    if (incomingValue === undefined) continue
    if ((local[field] ?? null) !== incomingValue) changed.push(field)
  }
  return changed
}

/**
 * Abgleich: einmal geschrieben, für jeden Bereich gleich. Reine Funktion ohne I/O -- schreibt
 * nichts, mutiert weder existing noch incoming. Das eigentliche Schreiben passiert außerhalb
 * dieses Packages, nach ausdrücklicher Bestätigung des vorgeschlagenen Plans.
 */
export function planSync<TLocal, TExternal>(input: {
  existing: readonly TLocal[]
  incoming: readonly TExternal[]
  match: MatchStrategy<TLocal, TExternal>
  policy: SyncPolicy
}): SyncPlan<TLocal, TExternal> {
  const { existing, incoming, match, policy } = input

  const created: TExternal[] = []
  const updated: SyncUpdate<TLocal, TExternal>[] = []
  const skipped: SyncSkip<TLocal, TExternal>[] = []
  const conflicts: SyncConflict<TLocal, TExternal>[] = []
  const matchedLocals = new Set<TLocal>()
  // Eine Quelle kann dieselbe externe ID zweimal liefern (doppelte Zeile im Export). Ohne diese
  // Erfassung liefe jede Wiederholung erneut durch den Abgleich: zweimal 'created' fuer dieselbe
  // Identitaet (der Unique-Index auf (organization_id, source_id, external_id) laesst das nicht zu
  // und liesse den halb geschriebenen Lauf abbrechen) oder zwei 'updated' auf denselben lokalen
  // Datensatz, von denen stillschweigend der letzte gewinnt.
  const seenExternalIds = new Set<string>()

  const applyMatch = (local: TLocal, external: TExternal): void => {
    matchedLocals.add(local)
    const changedFields = diffFields(match.fieldsOf(local), match.fieldsOf(external))
    if (changedFields.length === 0) {
      skipped.push({ local, external, reason: 'unchanged' })
      return
    }
    const localUpdatedAt = match.localUpdatedAtOf(local)
    const sourceUpdatedAt = match.sourceUpdatedAtOf(external)
    if (localUpdatedAt && sourceUpdatedAt && localUpdatedAt > sourceUpdatedAt) {
      // Lokale Korrektur gewinnt komplett gegen eine ältere Quelle -- keine Teilübernahme
      // einzelner Felder, sonst könnte eine Quelle ein bewusst korrigiertes Feld zurückdrehen.
      skipped.push({ local, external, reason: 'local_newer' })
      return
    }
    updated.push({ local, external, changedFields })
  }

  for (const external of incoming) {
    const unknownRefs = match.unknownStructureRefs?.(external) ?? []
    if (unknownRefs.length > 0) {
      conflicts.push({
        kind: 'unknown_structure',
        label: match.labelOf(external),
        incoming: external,
        reason: unknownRefs.join(', '),
      })
      continue
    }

    const identity = match.identityOf(external)
    if ('externalId' in identity) {
      if (seenExternalIds.has(identity.externalId)) {
        conflicts.push({
          kind: 'invalid_record',
          label: match.labelOf(external),
          externalId: identity.externalId,
          incoming: external,
          reason: 'duplicate_external_id',
        })
        continue
      }
      seenExternalIds.add(identity.externalId)
      const localMatch = existing.find((local) => match.externalIdOf(local) === identity.externalId)
      if (localMatch) {
        applyMatch(localMatch, external)
      } else {
        created.push(external)
      }
      continue
    }

    // Kein externalId: nur unscharfer Abgleich möglich. Jeder Treffer -- auch genau einer --
    // ist eine Vermutung, nie eine Gewissheit, und wird deshalb immer zum Konflikt statt zu
    // einer automatischen Zuordnung (Plan: "Kein unscharfer Treffer ohne Rückfrage"). Nur wenn
    // gar kein Kandidat passt, ist der Datensatz wirklich neu.
    const candidates = existing.filter((local) => sameFuzzyKey(match.fuzzyKeyOf(local), identity.fuzzy))
    if (candidates.length === 0) {
      created.push(external)
    } else {
      // Ein Kandidat, der zu einem Konflikt gehoert, ist nicht "verschwunden" -- er ist nur nicht
      // eindeutig zuzuordnen. Ohne diese Markierung wuerde retired ihn faelschlich als "left"
      // vorschlagen, obwohl er (unter einer anderen oder derselben Identitaet) weiterhin in der
      // Quelle steht -- die Person waere gleichzeitig ein offener Konflikt UND als ausgetreten
      // markiert (beim adversarialen Review gefunden).
      for (const candidate of candidates) matchedLocals.add(candidate)
      conflicts.push({
        kind: 'ambiguous_match',
        label: match.labelOf(external),
        incoming: external,
        candidates,
      })
    }
  }

  // Nur retirable Datensaetze koennen "aus der Quelle verschwunden" sein -- ein Datensatz ohne
  // jede Quellenbindung (source_id null) stand nie zur Disposition dieses Laufs, er war nur ein
  // Abgleichskandidat gegen Duplikate (siehe MatchStrategy.isRetirable).
  const retirableExisting = match.isRetirable ? existing.filter((local) => match.isRetirable!(local)) : existing
  const retired = retirableExisting.filter((local) => !matchedLocals.has(local))

  // Verlustschwelle vor der Rückgabe prüfen: 'retired' ist genau die Menge der in incoming
  // fehlenden, bekannten Datensätze. Ein unvollständiger Export darf keine Datenbank leeren.
  // Nenner ist bewusst retirableExisting, nicht existing -- sonst wuerden nicht-retirable
  // Datensaetze (von Hand gepflegt) den Prozentsatz verzerren, obwohl sie nie zur Debatte standen.
  if (retirableExisting.length > 0) {
    const lossPercent = (retired.length / retirableExisting.length) * 100
    if (lossPercent > policy.lossThresholdPercent) {
      return {
        aborted: true,
        reason: 'loss_threshold_exceeded',
        existingCount: retirableExisting.length,
        missingCount: retired.length,
        lossPercent,
      }
    }
  }

  return {
    aborted: false,
    created,
    updated,
    retired,
    skipped,
    conflicts,
    counts: {
      created: created.length,
      updated: updated.length,
      retired: retired.length,
      skipped: skipped.length,
      conflicts: conflicts.length,
    },
  }
}
