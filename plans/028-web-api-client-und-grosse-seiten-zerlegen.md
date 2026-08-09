# Plan 028: Web-API-Zugriffe vereinheitlichen und große Seiten zerlegen

> **Executor instructions**: Folge den Schritten. Bewahre SSR-Verhalten und deutsche UX-Texte; keine Backend-Verträge ändern.
>
> **Drift check (run first)**: `git diff --stat 1883758f..HEAD -- apps/web`

## Status

- **Priority**: P2
- **Implementation note (2026-08-09)**: in Arbeit auf PR #33 mit Folge-PR #34. `useApiClient()` delegiert an den testbaren Kern `app/utils/apiClient.ts`; dieser vereinheitlicht API-Basis-URL, Bearer-Header ohne Session-Cache, optionale Zod-Validierung und typisierte Serverfehler. Öffentliche Anfragen können Auth explizit abschalten. Die API-Mutationen von `marke.vue`, `mitglieder.vue` und `integrationen.vue` sowie die Ladepfade von `kanaele.vue`, `einstellungen/recht.vue` und `mitglieder.vue` sind migriert. `marke.vue` widerruft temporäre Logo-Object-URLs jetzt auch beim Unmount. Ausgelagert sind `LegalAuditChain`, `ProcessorAgreements`, `BrandLivePreview` sowie die fünf Integrations-Komponenten `IntegrationSourceHeader`, `IntegrationSourceCreateForm`, `IntegrationSourceEditForm`, `IntegrationRunHistory` und `IntegrationConflictList`; `integrationen.vue` hat damit 440 LoC. Drei Testdateien mit acht Tests laufen verbindlich, `--passWithNoTests` ist entfernt. Restlich: fachlichen State von Marke/Mitgliedern/Integrationen in Composables ziehen, die übrigen großen Seiten weiter zerlegen, mindestens fünf Testdateien mit gezielten Seiten-Tests erreichen sowie den manuellen Browser-Smoke-Test durchführen.
- **Effort**: L
- **Risk**: MED
- **Depends on**: `plans/027-api-route-module-boundaries.md`
- **Category**: tech-debt, tests
- **Planned at**: commit `1883758f`, 2026-08-09

## Why this matters

24 Seiten erstellen Runtime-Config und API-URLs selbst, 19 bauen wiederholt einen Bearer-Header. Besonders `einstellungen/recht.vue` (851 LoC), `marke.vue` (750), `mitglieder.vue` (600), `integrationen.vue` (586) und `kanaele.vue` (578) mischen Laden, Mutation, State und Darstellung. Das produziert Drift bei Fehlerbehandlung und erschwert Tests.

## Current state

- `apps/web/app/composables/useAuthHeader.ts` holt aktuell pro Aufruf die Session.
- `apps/web/app/composables/useScope.ts` besitzt die aktive Tenant-Auswahl und muss SSR-sicher bleiben.
- `apps/web/app/pages/einstellungen/recht.vue:43-71` zeigt das wiederkehrende Load-/Header-/Parse-Muster; der Rest enthält fünf unabhängige Fachbereiche.
- `apps/web/app/pages/marke.vue:365-402` enthält drei nahezu parallele Save-Funktionen je Scope.
- `apps/web/app/pages/kanaele.vue:35-75` ist ein Beispiel für paralleles Laden und lokales Zod-Parsen.
- Es gibt `security.test.ts`, `utils/apiClient.test.ts` und `pages/apiClientMigration.test.ts`; der Web-Testlauf ist verbindlich und umfasst derzeit acht Tests.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Web typecheck | `pnpm --filter @vereinsfunk/web typecheck` | exit 0 |
| Web tests | `pnpm --filter @vereinsfunk/web test` | exit 0 |
| Build | `pnpm --filter @vereinsfunk/web build` | exit 0 |
| Full gate | `pnpm check` | exit 0 |

## Scope

**In scope**

- neue Composables unter `apps/web/app/composables/` und UI-Komponenten unter `apps/web/app/components/`
- die fünf genannten Seiten sowie zugehörige neue Tests

**Out of scope**

- keine Änderung an Auth, Cookie-Namen, Routing oder API-Endpunkten
- keine visuellen Redesigns und keine neue Komponentenbibliothek
- keine direkte Nutzung einer Supabase Service Role

## Steps

### Step 1: Minimalen API-Client als Composable einführen

Erstelle `useApiClient()` mit einem einzigen `request<T>(path, options, schema)`-Einstieg: API-Base-URL, Auth-Header, `$fetch`, Zod-Parsing und einen typisierten Fehlercode. Er darf keine globale Session cachen, die Logout/Token-Rotation übersieht. Öffentliche Token-Seiten dürfen den Client ohne Auth explizit nutzen. Migriere zuerst zwei kleine Seiten als Referenz.

**Verify**: neue Unit-Tests für Auth- und öffentliche Anfrage, Schemafehler und 401; `pnpm --filter @vereinsfunk/web test` → exit 0.

### Step 2: Fach-State aus den großen Seiten extrahieren

Erzeuge pro Seite ein domänenspezifisches Composable (`useLegalSettings`, `useBrandSettings`, `useMembers`, `useIntegrationSources`, `useChannels`). Es besitzt Laden, Mutation, Busy-State und Fehlertexte; Komponenten bekommen Props/Events statt direkter API-Aufrufe. Behalte parallele Ladeoperationen und deren Zod-Validierung bei.

**Verify je Seite**: Typecheck sowie gezielte Tests für Load-Erfolg, Berechtigungsfehler und eine Mutation.

### Step 3: Darstellung in kleine Komponenten teilen

Zerlege nach sichtbaren Fachabschnitten, nicht nach willkürlichen Zeilenzahlen: auf der Rechtsseite Retention, Betroffenenanfragen, Verarbeitung, Auftragsverarbeiter und Audit-Kette; auf der Markenseite Scope-Auswahl, Brand-Formular, Logo, Asset-/Lizenzliste und Vorschau. Die Seite bleibt nur Composition Root und soll unter 250 LoC liegen. Widerrufe Object-URLs weiterhin beim Ersetzen und beim Unmount.

**Verify**: `pnpm --filter @vereinsfunk/web build` → exit 0; manueller Smoke-Test jeder Seite mit echter Session.

### Step 4: Regressionstests verbindlich machen

Entferne `--passWithNoTests` erst, wenn mindestens die neuen Composable-/Komponententests stabil sind. Wenn Nuxt-Testumgebung dafür noch nicht konfiguriert ist, ergänze nur die kleinste offizielle Vitest/Vue-Testkonfiguration und dokumentiere sie; keine E2E-Infrastruktur in diesem Plan.

**Verify**: `pnpm --filter @vereinsfunk/web test` → exit 0 und mindestens fünf neue Testdateien werden ausgeführt.

## Done criteria

- [ ] Alle fünf großen Seiten liegen unter 500 LoC; Zielwert 250 LoC. (`integrationen.vue`: 440 LoC, die anderen vier stehen noch aus.)
- [ ] Kein `$fetch`-Boilerplate mit `config.public.apiBase` bleibt auf migrierten Seiten.
- [ ] API-Fehler und Zod-Validierung verhalten sich identisch oder besser getestet.
- [ ] `pnpm check` besteht.

## STOP conditions

- SSR-Hydration unterscheidet sich nach Auslagerung von Scope/Session.
- Eine Komponente braucht Service-Role- oder Secret-Daten.
- Das Extrahieren würde API-Verträge ändern.

## Maintenance notes

Neue Seiten verwenden `useApiClient`; Fachcomposables sollen keine UI-HTML erzeugen. Reviewer prüfen besonders Race Conditions bei Scope-Wechsel und das Aufräumen temporärer URLs.
