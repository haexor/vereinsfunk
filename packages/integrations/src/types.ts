import type { ZodType } from 'zod'

export type IntegrationDomain = 'people' | 'teams' | 'fixtures' | 'events'
export type SourceTransportKind = 'file' | 'http' | 'ical' | 'webhook'

/** Transport: woher kommen rohe Datensätze? */
export interface SourceTransport {
  readonly kind: SourceTransportKind // deckungsgleich mit integration_transport
  readonly key: string
  read(options: { since?: Date }): AsyncIterable<Readonly<Record<string, unknown>>>
}

/** Externe Spalte/Feld -> interner Feldname, z. B. { Vorname: 'firstName' }. */
export type FieldMapping = Record<string, string>

/** Bereich: was ist ein Datensatz fachlich, und was darf davon behalten werden? */
export interface DomainAdapter<TExternal> {
  readonly domain: IntegrationDomain
  readonly schema: ZodType<TExternal> // erzwingt Datenminimierung
  normalize(raw: Readonly<Record<string, unknown>>, mapping: FieldMapping): unknown
  identityOf(entity: TExternal): { externalId: string } | { fuzzy: string[] }
}

export interface SyncPolicy {
  readonly lossThresholdPercent: number
}

// Deckungsgleich mit dem CHECK auf integration_sync_conflicts.kind (Migration 014).
export type SyncConflictKind = 'ambiguous_match' | 'unknown_structure' | 'value_conflict' | 'invalid_record'

/**
 * Wie planSync einen TExternal-Eintrag gegen existing: TLocal[] abgleicht. Ein Bereichsadapter
 * implementiert diese Funktionen anhand seines eigenen DomainAdapter.identityOf und seiner
 * eigenen Feldnamen -- planSync selbst kennt weder Personen noch Termine.
 */
export interface MatchStrategy<TLocal, TExternal> {
  /** Wie DomainAdapter.identityOf: externe ID, falls vorhanden, sonst Merkmale für den unscharfen Abgleich. */
  identityOf(entity: TExternal): { externalId: string } | { fuzzy: readonly string[] }
  /** Externe ID eines bereits synchronisierten Datensatzes; kein früherer Sync => undefined. */
  externalIdOf(local: TLocal): string | undefined
  /** Dieselbe Art Merkmale wie identityOf(...).fuzzy, aber für den lokalen Datensatz. */
  fuzzyKeyOf(local: TLocal): readonly string[]
  /**
   * Vergleichbare Feldwerte für Änderungserkennung (Feldname -> Wert), gleiche Feldnamen auf
   * beiden Seiten. `undefined` auf der externen Seite heißt "die Quelle sagt zu diesem Feld
   * nichts" und zählt nie als Unterschied -- eine Datei ohne Geburtsjahr-Spalte darf ein lokal
   * gepflegtes Geburtsjahr nicht leeren. `null` heißt dagegen ausdrücklich "leer".
   */
  fieldsOf(entity: TLocal | TExternal): Readonly<Record<string, string | number | boolean | null | undefined>>
  /** Anzeigename für Konfliktzeilen (Personenname, Termintitel, ...). */
  labelOf(entity: TLocal | TExternal): string
  sourceUpdatedAtOf(entity: TExternal): Date | undefined
  localUpdatedAtOf(local: TLocal): Date | undefined
  /**
   * Bereichsspezifische Struktur-Prüfung (z. B. unbekannte Abteilung). planSync kennt die
   * Fachstruktur nicht, ruft diesen optionalen Hook aber für den Konflikttyp 'unknown_structure'
   * auf. Nicht-leeres Ergebnis => Konflikt statt Anlage/Änderung.
   */
  unknownStructureRefs?(entity: TExternal): readonly string[]
  /**
   * Ob ein unmatched existing-Datensatz überhaupt als "aus der Quelle verschwunden" gelten darf.
   * Ohne diesen Hook gilt jeder existing-Eintrag als retirable -- das ist falsch für Datensätze,
   * die nie aus IRGENDEINER Quelle stammen (source_id null): sie stehen in existing ausschließlich
   * für den unscharfen Abgleich (Duplikatvermeidung gegen von Hand gepflegte Einträge), nie zur
   * Disposition eines Sync-Laufs, der sie nie "besessen" hat. Ohne diese Unterscheidung würde ein
   * völlig unabhängiger Import eine von Hand angelegte Person als "left" markieren, nur weil sie in
   * dieser einen Datei nicht vorkommt. Fehlt der Hook, bleibt das alte Verhalten (alles retirable)
   * bestehen.
   */
  isRetirable?(local: TLocal): boolean
}

export interface SyncUpdate<TLocal, TExternal> {
  readonly local: TLocal
  readonly external: TExternal
  readonly changedFields: readonly string[]
}

export interface SyncSkip<TLocal, TExternal> {
  readonly local: TLocal
  readonly external: TExternal
  readonly reason: 'unchanged' | 'local_newer'
}

export interface SyncConflict<TLocal, TExternal> {
  readonly kind: SyncConflictKind
  readonly label: string
  readonly externalId?: string
  readonly local?: TLocal
  /** Bei 'ambiguous_match': alle unscharf infrage kommenden Datensätze. */
  readonly candidates?: readonly TLocal[]
  readonly incoming?: TExternal
  readonly field?: string
  readonly currentValue?: string
  readonly incomingValue?: string
  readonly reason?: string
}

export interface SyncPlanCounts {
  readonly created: number
  readonly updated: number
  readonly retired: number
  readonly skipped: number
  readonly conflicts: number
}

export interface SyncPlanResult<TLocal, TExternal> {
  readonly aborted: false
  readonly created: readonly TExternal[]
  readonly updated: readonly SyncUpdate<TLocal, TExternal>[]
  /** Nie gelöscht, nur als Kandidat für "left"/"cancelled"/"archived" markiert -- Sache des Bereichs. */
  readonly retired: readonly TLocal[]
  readonly skipped: readonly SyncSkip<TLocal, TExternal>[]
  readonly conflicts: readonly SyncConflict<TLocal, TExternal>[]
  readonly counts: SyncPlanCounts
}

export interface SyncPlanAborted {
  readonly aborted: true
  readonly reason: 'loss_threshold_exceeded'
  readonly existingCount: number
  readonly missingCount: number
  readonly lossPercent: number
}

export type SyncPlan<TLocal, TExternal> = SyncPlanResult<TLocal, TExternal> | SyncPlanAborted
