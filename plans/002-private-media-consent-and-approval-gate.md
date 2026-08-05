# 002 – Private Medien, Einwilligungen und Freigabegate

## Ergebnis

Uploads werden wirklich privat gespeichert, geprüft und mit nachvollziehbaren Entscheidungen pro erkennbarer Person verknüpft. Eine Freigabe gilt nur für eine konkrete Post-Version und konkrete, unveränderliche Medien-Derivate. Offene Gesichter oder fehlende Pflichtentscheidungen blockieren Veröffentlichung.

## Ausgangslage und Evidenz

Geplant auf `unborn HEAD` am 2026-08-02.

- `apps/web/app/pages/erstellen.vue:53` zeigt einen Datei-Input, lädt aber nichts hoch.
- `202608020002_private_storage.sql` legt private Buckets an, aber keine fachlichen Medientabellen.
- `202608020001_initial_tenant_foundation.sql:172-231` modelliert unveränderliche Versionen und Freigaben, referenziert aber keine konkreten Derivate.
- `packages/contracts/src/index.ts:19-24` kennt `minor` und `missing_consent` nur als grobe Safety Flags.
- AGENTS.md fordert private Medien, Tenant-RLS, zusammengesetzte FKs, immutable approvals und Service Role nur in API/Workern.

Baseline-Hashes:

```text
28dc50f3bec1cc32a9e8925d82ff67c712ab15632ea28313c380264b5d082194  apps/web/app/pages/erstellen.vue
0e2b191a196ea146385d7cb4409f7f3669c2f98cd9b950afd2988d81e561db5b  supabase/migrations/202608020001_initial_tenant_foundation.sql
2f001e9e7baac3f76d9cbc14d856666a3d068d2a04fd4d53d4e14d6e40f6cf78  supabase/migrations/202608020002_private_storage.sql
2b3384e745ccacbe2c19b5548f5e3735679b3b2058b091f2f8f6d42214891c52  packages/contracts/src/index.ts
```

## Scope

- additive Migrationen für Medien, Regionen, Einwilligungen, Derivate und Post-Zuordnung
- RLS-/Storage-Tests
- Vertrags- und API-Schemas
- Fastify-Endpunkte für Upload-Initialisierung, Abschluss, Review und Derivatauswahl
- Nuxt-Upload und Review-Status
- Freigabe-/Publikationsgate in Domain/API
- ADR zu personenbezogenen Medien

Nicht enthalten: automatische Gesichtslokalisierung und eigentliche Bildverdeckung (Plan 003), Video-Face-Tracking, Rechtsberatung oder öffentliche Original-URLs.

## Datenmodell

Alle Tabellen tragen `organization_id`; Referenzen auf Abteilung/Submission/Post verwenden zusammengesetzte Tenant-FKs.

- `media_assets`: Originalobjekt, Bucket/Pfad, MIME, Bytes, SHA-256, Maße/Dauer, Uploadstatus, `contains_minors`, `exif_stripped_at`, Scanstatus, Ersteller.
- `face_regions`: normalisierte Box (`x`, `y`, `width`, `height` jeweils 0..1), Quelle `automatic|manual`, Confidence, `subject_kind=adult|minor|unknown`, Entscheidung `pending|consented|obscure|exclude`, Stil, Revisionsnummer.
- `consent_records`: minimaler pseudonymer Betroffenenbezug, Geltungsbereich, Erteiler/Guardian-Flag, gültig von/bis, Widerruf, privater Dokumentpfad und Auditdaten. Keine Gesichts-Embeddings.
- `media_derivatives`: Original-ID, Transformationsrezept/-version, privater Pfad, SHA-256, Maße, Status und Zeitpunkt. Unveränderlich ab `ready`.
- `post_media`: konkrete `post_version_id`, konkrete `media_derivative_id`, Position, Rolle, Alt-Text.
- `approval_media_snapshots`: optional separate Snapshot-Tabelle oder deterministische Prüfsummenliste auf `approval_requests`; sie friert Reihenfolge und Hashes ein.

Der Originalpfad darf in `post_media` nicht referenziert werden.

## Umsetzung

### 1. Schema, Constraints und RLS

- Führe Tabellen, Unique-Constraints und zusammengesetzte Tenant-FKs additiv ein.
- Verhindere per Constraint/Trigger: `ready`-Derivate ändern, `post_media` mit Originalen, `consented` ohne gültigen Consent-Record, Freigabesnapshot mit nicht fertigen Derivaten.
- Storage-Pfade beginnen mit `organization_id/department_id/asset_id/`; Policies prüfen Pfad und Mitgliedschaft.
- Originale sind nur für berechtigte Editoren/Approver sichtbar; Publisher erhält ausschließlich das freigegebene Derivat über kurzlebige Server-URL.
- Ergänze positive und negative pgTAP-Fälle für zwei Organisationen, Rollen, Pfad-Traversal, abgelaufene/widerrufene Einwilligung und Immutable-Constraints.

### 2. Verträge und Freigabeentscheidung

Definiere Zod-Schemas für:

```ts
type FaceDecision =
  | { kind: 'consented'; consentRecordId: string }
  | { kind: 'obscure'; style: ObscuringStyle }
  | { kind: 'exclude' }

type MediaGateResult = {
  publishable: boolean
  blockers: Array<'scan_pending' | 'face_pending' | 'consent_invalid' |
    'derivative_stale' | 'minor_review_required' | 'original_selected'>
}
```

- Entscheidungen sind revisionsgebunden; jede Änderung invalidiert davon abhängige Derivate und Freigaben.
- `minor_review_required` bleibt auch nach technischer Verdeckung eine eigene, explizit zu bestätigende Freigabestufe.
- Verfasse Produkttexte bewusst ohne Rechtsgarantie: Verdeckung reduziert Sichtbarkeit des Gesichts, Kontext kann identifizieren.

### 3. Sicherer Uploadpfad

- Fastify authentifiziert Sitzung und Berechtigung, erzeugt Asset-ID und kurzlebige signierte Upload-URL.
- Der Client lädt direkt in den privaten Bucket; `complete` prüft Objektgröße, MIME per Inhalt statt nur Dateiendung und SHA-256.
- Ein Worker normalisiert Orientierung, entfernt EXIF/GPS und schreibt ein internes, ebenfalls privates Normalized Original. Das rohe Uploadobjekt wird nach erfolgreicher Verarbeitung gemäß Aufbewahrungsregel entfernt oder quarantänisiert.
- Weder Service-Role-Key noch persistente Storage-URL gelangen in den Browser oder Hatchet-Payload.
- Virus-/Dateiscans haben einen expliziten Status; `pending` und `failed` blockieren.

### 4. Review- und Freigabegate

- Nuxt zeigt für jedes Asset: Verarbeitung, erkannte/manuelle Regionen, Minderjährigenstatus, Entscheidung und daraus erzeugte Vorschau.
- Ohne Regionen muss ein Mensch ausdrücklich „keine erkennbaren Gesichter“ bestätigen; dies verhindert, dass ein Detektorfehler still als sicher gilt.
- Beim Erstellen eines `approval_request` wird die Post-Version plus geordnete Liste `derivative_id:sha256` eingefroren.
- Jede Medien-/Textänderung nach Freigabe erzeugt eine neue Version und benötigt neue Freigabe.
- Der Publishing-Use-Case lädt den Snapshot erneut und bricht vor externem I/O ab, wenn Gate oder Hashvergleich fehlschlägt.

### 5. Audit und Aufbewahrung

- Audit-Events: Upload, Detectorlauf, manuelle Box, Entscheidungsänderung, Einwilligung angelegt/widerrufen, Derivat erzeugt, Freigabe invalidiert, Veröffentlichung blockiert.
- Definiere konfigurierbare Fristen für rohe Uploads, nicht verwendete Originale und widerrufene Inhalte. Löschung muss Referenzen/Audit erhalten, aber Medienzugriff entziehen.
- Dokumentiere Auskunfts-/Löschprozess und Backup-Restore-Test, ohne in Produkttexten Rechtsberatung zu behaupten.

## Tests und Verifikation

```bash
pnpm --filter @vereinsfunk/contracts test
pnpm --filter @vereinsfunk/domain test
pnpm --filter @vereinsfunk/api test
pnpm db:reset
pnpm db:test
pnpm check
```

Pflichtszenarien:

1. Asset ohne Personen, menschlich bestätigt → freigabefähig.
2. Erwachsene Person mit gültiger Einwilligung → freigabefähig.
3. Person ohne Einwilligung, noch unverdeckt → blockiert.
4. Minderjähriges Kind, verdeckt → zusätzliche Kinderprüfung erforderlich.
5. Einwilligung nach Freigabe widerrufen → Snapshot ungültig, geplante Veröffentlichung storniert.
6. Derivat nach Freigabe geändert → Hashvergleich blockiert.
7. Nutzer aus Organisation B kann weder Objekt noch Metadaten aus A lesen.

## Done-Kriterien

- Private Uploads funktionieren ohne Service Role im Browser.
- Original, normalized Original und veröffentlichbares Derivat sind getrennt.
- Jede erkennbare Person hat eine explizite, versionierte Entscheidung.
- Post-Freigaben binden Version und Derivat-Hashes; Änderungen invalidieren sie.
- Kein Publishingpfad kann ein Original oder ein ungeprüftes Derivat erhalten.
- RLS-, Storage-, Domain-, API- und Workspace-Tests sind grün.

## STOP-Bedingungen

- Es ist unklar, welche Einwilligungsnachweise und Fristen der Pilotverein benötigt: Schema so weit generisch halten, aber produktiven Einsatz vor Klärung stoppen.
- Supabase Storage Policies können den geplanten Pfad nicht tenant-sicher ausdrücken: Upload nicht mit bloßem UI-Schutz freigeben.
- Ein bestehender Post kann ohne neue Freigabe Medien wechseln: vor weiterer Arbeit zuerst Versionsinvariante reparieren.

## Pflegehinweis

Vierteljährlich Aufbewahrungsjobs, widerrufene Einwilligungen, verwaiste Derivate und Storage/RLS-Negativtests prüfen. Transformationsrezepte sind versioniert; alte freigegebene Derivate werden nie still neu gerendert.
