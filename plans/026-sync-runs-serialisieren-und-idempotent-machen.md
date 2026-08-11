# Plan 026: Synchronisationsläufe pro Quelle serialisieren und wiederholbar machen

> **Executor instructions**: Dieses Dokument vollständig lesen, die Schritte in Reihenfolge ausführen und nach jedem Schritt verifizieren. Bei einer STOP-Bedingung anhalten und berichten. Danach den Status dieses Plans im Index aktualisieren.
>
> **Drift check (run first)**: `git diff --stat 1883758f..HEAD -- apps/api/src/app.ts apps/api/src/app.test.ts supabase/migrations supabase/tests packages/integrations`

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH — der Pfad verändert personenbezogene Vereinsdaten.
- **Depends on**: none
- **Category**: bug, security, migration
- **Planned at**: commit `1883758f`, 2026-08-09

## Why this matters

`POST /v1/integration-sources/:id/sync` kann denselben Lauf mehrfach oder parallel starten. Die Tabelle schützt nur die Zugehörigkeit zum Mandanten, nicht einen aktiven Lauf je Quelle und Domäne. Zwei Apply-Läufe lesen denselben Ausgangszustand und können anschließend widersprüchliche Inserts, Updates oder Stilllegungen ausführen. ADR-009 nennt dies ausdrücklich als offene Grenze; vor jeder fachlichen Umstellung auf einen geplanten Workflow muss sie geschlossen sein.

## Current state

- `apps/api/src/app.ts:5516-5943` enthält Parsing, Planen und Anwenden des Menschen-Imports; die Domänen `teams`, `fixtures` und `events` verzweigen in die drei Handler oberhalb von `buildApp`.
- `apps/api/src/app.ts:5742-5752` legt einen Run vor den Schreibvorgängen an, besitzt aber weder Sperre noch Idempotenzschlüssel.
- `supabase/migrations/2026080703_integration_framework.sql:105-130` definiert `integration_sync_runs`; vorhanden ist lediglich ein Index auf `(organization_id, source_id, started_at)`.
- `docs/adr/ADR-009-integration-framework.md` verlangt eine Sperre je Quelle und Bereich sowie Idempotenz über den gesamten Lauf; Supabase bleibt Source of Truth.
- Bestehende API-Testmuster stehen in `apps/api/src/app.test.ts` unter `describe('Paket 014…')`; pgTAP-Muster in `supabase/tests/directory_and_integrations.test.sql`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Unit/API tests | `pnpm --filter @vereinsfunk/api test` | exit 0 |
| DB reset | `pnpm db:reset` | exit 0, lokale DB migriert |
| RLS/SQL tests | `pnpm db:test` | exit 0 |
| Full gate | `pnpm check` | exit 0 |

## Scope

**In scope**

- neue additive Migration und zugehörige pgTAP-Tests unter `supabase/`
- `apps/api/src/app.ts`, höchstens die Synchronisationsroute und deren extrahierte Shared-Helper
- `apps/api/src/app.test.ts`
- `docs/adr/ADR-009-integration-framework.md` und `plans/README.md`

**Out of scope**

- keine Änderung an Match-Strategien in `packages/integrations` oder `packages/club-schedule`
- keine Umstellung auf Hatchet; der aktuelle synchrone Endpunkt bleibt der einzige Trigger
- keine nachträgliche Transaktion über Storage oder Provider-Aufrufe

## Steps

### Step 1: Laufvertrag und atomare Quelle-Sperre ergänzen

Erstelle eine neue, nur additive Migration. Ergänze auf `integration_sync_runs` einen vom Server erzeugten eindeutigen Lauf-Schlüssel für `(organization_id, source_id, domain, request_idempotency_key)` und sichere höchstens einen `running`-Apply-Lauf pro `(organization_id, source_id, domain)` mit einem partiellen Unique-Index **oder** implementiere eine `security definer`-RPC, die einen transaktionalen Advisory Lock auf Quelle plus Domäne nimmt und danach den Run anlegt. Bevorzuge die RPC, wenn der partielle Index den Übergang `running → succeeded|failed` nicht sauber abbildet.

Die Schutzfunktion muss: die Quelle zur Organisation prüfen, einen bestehenden Lauf mit demselben Idempotenzschlüssel zurückgeben, einen konkurrierenden aktiven Apply-Lauf als `sync_already_running` ablehnen und Dry-Runs bewusst entweder genauso serialisieren oder durch einen dokumentierten, getesteten Grund ausnehmen. Der gesamte Check-und-Anlege-Schritt darf nicht in TypeScript zwischen zwei Queries stattfinden.

**Verify**: `pnpm db:reset && pnpm db:test` → neue positive und negative SQL-Tests bestehen.

### Step 2: API-Idempotenz und einheitlichen Abschluss verdrahten

Erweitere die Route mit einem validierten Idempotenzschlüssel, bevorzugt aus `Idempotency-Key` (UUID oder begrenzter, sicherer String); fehlt er, generiert die API einen und gibt ihn im Response zurück. Rufe die DB-Sperre an, bevor externe iCal-Inhalte gelesen oder fachliche Zeilen geladen werden. Bei gleichem Schlüssel muss der laufende oder abgeschlossene Run ohne erneutes Anwenden zurückgegeben werden; bei einem anderen Schlüssel und aktivem Apply-Lauf `409 sync_already_running`.

Führe den Abschluss aller vier Domänen durch genau einen Helper: Erfolg, Abbruch und unerwarteter Fehler setzen `finished_at`, Status, Zähler, Fehlerklasse und `integration_sources.last_sync_*` konsistent. Behalte die von ADR-009 verlangte Auditierbarkeit auch bei einem Teilfehler. Service Role nur nach Authentifizierung und Berechtigungsprüfung verwenden.

**Verify**: `pnpm --filter @vereinsfunk/api test` → bestehende Sync-Tests und neue Parallel-/Replay-Fälle bestehen.

### Step 3: Wiederherstellungssemantik dokumentieren

Ergänze ADR-009: gesperrte Quelle, Idempotenzvertrag, Verhalten bei Prozessabbruch und bewusste Restgrenze einer nicht globalen Daten-Transaktion. Ein festgefahrener Run braucht eine klar definierte, auditierte Recovery (zeitlich begrenztes Lease oder expliziter Admin-Abbruch); niemals darf ein neuer Lauf ohne nachvollziehbaren Status darüber hinwegschreiben.

**Verify**: `pnpm check` → exit 0.

## Test plan

- zwei parallele Apply-Anfragen derselben Quelle/Domäne: genau eine führt Schreiboperationen aus, die andere erhält 409;
- identischer Idempotenzschlüssel: keine zweite Quelle wird gelesen und keine zweite Run-Zeile erzeugt;
- Dry-Run schreibt keine fachlichen Zeilen;
- Fehler nach Run-Anlage schreibt `failed` plus `finished_at`;
- ein Lauf einer anderen Quelle oder Domäne bleibt parallel möglich;
- Cross-Tenant-Quelle kann weder gesperrt noch gelesen werden.

## Done criteria

- [x] Pro Quelle/Domäne läuft höchstens ein Apply-Lauf.
- [x] Wiederholte Requests sind idempotent und auditierbar.
- [x] Positive und negative pgTAP- sowie API-Tests bestehen.
- [x] `pnpm check`, `pnpm db:reset` und `pnpm db:test` bestehen.

## Umsetzung: Ergebnis und Abweichungen vom Plan

- `2026080903_sync_run_idempotency.sql` ergänzt einen serverseitigen Idempotenzschlüssel und die Service-Role-RPC `acquire_integration_sync_run`. Die RPC prüft die Zugehörigkeit der Quelle zur Organisation, liefert Replays zurück und sichert gleichzeitig höchstens einen laufenden Apply-Lauf je Quelle und Bereich. Dry-Runs werden bewusst nicht serialisiert, weil sie keine Fachzeilen schreiben.
- Die API reserviert den Lauf nach Parsing der kleinen Routing-Metadaten, aber vor dem Lesen der Uploaddatei, dem iCal-Abruf und jeder Abfrage von Personen, Mannschaften, Spielen oder Veranstaltungen. Ein fehlender Schlüssel wird als UUID erzeugt und in jeder erfolgreichen Antwort zurückgegeben.
- Alle vier Domänen verwenden denselben Abschlussweg für Erfolg, Verlustschwellenabbruch und Fehler. `POST /v1/integration-sources/:id/sync-runs/:runId/cancel` ist die explizite, auditierte Recovery für bestätigte Prozessabbrüche; es ist kein Interrupt eines noch laufenden Requests.
- Verifiziert mit `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm db:reset` und `pnpm db:test` am 2026-08-09.

## STOP conditions

- Die DB kann die Sperre nicht atomar durchsetzen.
- Eine vorgeschlagene Migration müsste historische Migrationen ändern.
- Die Lösung transportiert vollständige Importdaten oder Secrets in einen Workflow-Payload.

## Maintenance notes

Jeder künftige Cron-/Hatchet-Trigger muss denselben DB-Guard verwenden; eine nur im HTTP-Endpunkt liegende Sperre wäre unvollständig. Paket 004 stellt dafür die technische Ausführungsgrenze bereit, ersetzt aber nicht diesen fachlichen Guard.
