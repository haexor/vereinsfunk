# Plan 027: Fastify-API in fachliche Route-Module zerlegen

> **Executor instructions**: Vollständig lesen. Halte Response-Formate, Berechtigungen und Migrationen unverändert; führe jeden Testschritt aus.
>
> **Drift check (run first)**: `git diff --stat 1883758f..HEAD -- apps/api/src`

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH — zentrale Authentifizierungs- und Tenant-Grenze.
- **Depends on**: `plans/026-sync-runs-serialisieren-und-idempotent-machen.md`
- **Category**: tech-debt, tests
- **Planned at**: commit `1883758f`, 2026-08-09

## Why this matters

`apps/api/src/app.ts` umfasst 8.301 LoC: Infrastruktur, rund 90 Routen, Datenmapper und fachliche Workflows. Dadurch muss jede Änderung einen riesigen Kontext anfassen und kann unbemerkt Berechtigungs- oder Tenant-Verhalten verändern. Die Zerlegung soll ausschließlich Modulgrenzen schaffen; sie ist kein API-Redesign.

## Current state

- Stand 2026-08-10: `apps/api/src/app.ts` ist auf 5.162 LoC gesunken (Ausgangswert 8.301 LoC). Bereits extrahiert: `routes/context.ts` (`ApiRouteContext`), `routes/organization.ts` (Brand/Organisation), `routes/structure.ts` (Abteilungen/Teams), `routes/members.ts` (Mitglieder/Mitgliedschaften/Einladungen) und `routes/policies.ts` (Richtlinien und Freigaben, 1.440 LoC — die bisher größte Extraktion, siehe unten). `routes/shared.ts` (302 LoC) ist auf vier Extraktionen gewachsen: `fetchAllRows`/`fetchAllRowsForIds`/`resolveMembershipScope`/`toPermissionScope` (aus Paket 010/023-Zeit) sowie `notExpiredFilter`/`isAnyMemberOfOrganization`/`checkRateLimit`/`createAuditRecorder`/`CONSENT_RECORD_SELECT`/`ConsentRecordRow`/die komplette Regelauflösung (`POLICY_RULE_COLUMNS`, `PolicyRuleRow(s)`, `fetchPolicyRuleRows`, `ownPolicyRuleRow`, `toRuleOverride`, `computeRuleEntry`, `resolveScopedEffectiveConfig`, `fetchMemberTrust`) — alle domänenübergreifend gebraucht (siehe „Erkenntnis" unten), deshalb zentral statt je Modul dupliziert.
- Noch in `app.ts`: Kanäle/OAuth/Publishing, Integration/Verzeichnis/Einwilligung, Datenschutz (Retention, Auskunft/Löschung, Auftragsverarbeiter, Audit-Chain, Impressum), Analytics, `POST /v1/submissions` (Inhalts-Pipeline, in keiner der acht Domänen benannt) — sowie Plattform-Administration (Paket 022) und die LLM-Provider-Verwaltung, die direkt daran anschließt (beide `requirePlatformAdmin`-gated, in keiner der ursprünglich benannten Domänen enthalten und bei der nächsten Extraktion eine eigene Zuordnung brauchen).
- **Erkenntnis aus der Richtlinien/Freigaben-Extraktion**: die Regelauflösung (`fetchPolicyRuleRows`/`computeRuleEntry`/`fetchMemberTrust` u. a.) ist kein Domänen-internes Detail, sondern wird auch von `POST /v1/submissions` gebraucht (Paket 011: `evaluateSubmitPermission` vor der ersten Persistenz). Ebenso `recordAuditEvent` (fast jede verbleibende Domäne) und `isAnyMemberOfOrganization`/`checkRateLimit` (Kanäle, Integration, Datenschutz). `recordAuditEvent` brauchte dafür eine Factory (`createAuditRecorder(supabaseClients)`) statt einer einzelnen Funktion, weil es `supabaseClients` bisher aus der `buildApp`-Closure bezog — `app.ts` und jedes Route-Modul rufen sie einmal auf und behalten den vertrauten Zwei-Parameter-Aufruf. Wer als Nächstes extrahiert, sollte vor dem Verschieben einer scheinbar domänenlokalen Funktion knapp prüfen, ob sie auch außerhalb der eigenen Zeilenspanne aufgerufen wird (`grep -n "<funktionsname>("  apps/api/src/app.ts`) statt sich auf die Nähe zu den eigenen Routen zu verlassen.
- `apps/api/src/app.test.ts` wurde bislang **nicht** wie in Step 3 vorgesehen aufgeteilt: alle Tests (263, nach Paket/Feature per `describe`-Block geordnet) laufen weiterhin zentral und decken auch die bereits extrahierten Module ab. Das ist eine bewusste Abweichung der bisherigen Durchläufe, keine vergessene Aufgabe für die verbleibenden Domänen — wird hier für Transparenz nachgetragen, nicht rückwirkend korrigiert.
- `apps/api/src/auth.ts` ist das Vorbild für einen frameworknahen, testbaren Adapter; `apps/api/src/outboundFetch.ts` das Vorbild für eine schmale Infrastrukturgrenze.
- Architekturvorgaben: Zod an allen Grenzen, Service Role nur API/Worker, Provider hinter Interfaces, Tenant-IDs immer serverseitig konsistent.

### Fortschritt Step 3 (Domänen-Extraktion)

- [x] Route-Kontext (`routes/context.ts`)
- [x] Brand und Organisation (`routes/organization.ts`)
- [x] Struktur — Abteilungen und Teams (`routes/structure.ts`)
- [x] Mitglieder und Einladungen (`routes/members.ts`)
- [x] Richtlinien und Freigaben (`routes/policies.ts`) — inkl. Channel-Quotas (gehören inhaltlich zur Kontingent-/Richtlinienlogik aus Paket 011, nicht zu Kanäle/OAuth trotz des Namens)
- [ ] Kanäle, OAuth und Publishing
- [ ] Integration, Verzeichnis und Einwilligung
- [ ] Datenschutz
- [ ] Analytics
- [ ] Plattform-Administration (Paket 022) und LLM-Provider-Verwaltung — nicht in der ursprünglichen Domänenliste enthalten, bleiben bis zur Klärung in `app.ts`
- [ ] `POST /v1/submissions` (Inhalts-Pipeline) — ebenfalls nicht in der ursprünglichen Domänenliste enthalten

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| API test | `pnpm --filter @vereinsfunk/api test` | exit 0 |
| API check | `pnpm --filter @vereinsfunk/api typecheck` | exit 0 |
| Full gate | `pnpm check` | exit 0 |

## Scope

**In scope**

- `apps/api/src/app.ts`, neue Dateien unter `apps/api/src/routes/`, `apps/api/src/lib/` und `apps/api/src/services/`
- passende, aufgeteilte Tests unter `apps/api/src/routes/`

**Out of scope**

- keine Änderungen an Pfaden, HTTP-Methoden, Statuscodes, JSON-Feldern oder Zod-Verträgen
- keine Datenbankmigrationen oder RLS-Änderungen
- keine Änderung an `auth.ts`-Semantik ohne separates Security-Review

## Steps

### Step 1: Expliziten Route-Kontext schaffen

Erzeuge einen internen `ApiRouteContext`, der ausschließlich die bestehenden Injectables enthält: Environment, Supabase-Client-Factory, Guards, Role-/Platform-Admin-Provider, E-Mail-Sender, Upload-Service, OAuth-Client und Publisher-Factory. Erzeuge den Kontext einmal in `buildApp`; Route-Module erhalten ihn als Argument. Keine globalen Service-Clients und keine Service-Role im Modul-Import.

**Verify**: `pnpm --filter @vereinsfunk/api typecheck` → exit 0.

### Step 2: Reine Shared-Helfer extrahieren

Verschiebe Mapper, Pagination (`fetchAllRows`, `fetchAllRowsForIds`), Scope-Auflösung und klar abgegrenzte DTO-Definitionen in kleine Module. Behalte öffentliche und interne Typen präzise; ersetze nicht blind durch `Record<string, unknown>`. Jede extrahierte Funktion erhält mindestens Charakterisierungstests, wenn sie bisher nur indirekt getestet war.

**Verify**: `pnpm --filter @vereinsfunk/api test` → exit 0.

### Step 3: Routen inkrementell nach Fachdomäne verschieben

Extrahiere in dieser Reihenfolge und mit einem Commit je Domäne: (1) Brand/Organisation, (2) Struktur/Mitglieder/Einladungen, (3) Richtlinien/Freigaben, (4) Kanäle/OAuth/Publishing, (5) Integration/Verzeichnis/Einwilligung, (6) Datenschutz, (7) Analytics. Jedes Modul exportiert genau eine `register…Routes(app, context)`-Funktion. `buildApp` bleibt für Fastify-Setup, CORS, Multipart, Request-Hooks, Fehlerbehandlung und die geordnete Registrierung zuständig.

Nach jeder Extraktion alle betroffenen API-Tests aus `app.test.ts` in ein fachnahes `*.routes.test.ts` verschieben; gemeinsame Test-Fixtures bleiben zentral und werden nicht kopiert.

**Verify je Domäne**: `pnpm --filter @vereinsfunk/api test` → exit 0.

### Step 4: Tenant-Scope-Schutz zentral nachziehen

Erstelle keine pauschale Änderung an `SupabaseRoleProvider`, ohne alle Aufrufer zu prüfen. Stattdessen dokumentiere für jedes Route-Modul, ob IDs aus einer vertrauenswürdigen Zeile stammen oder ein `organizationId`/`departmentId`/`teamId`-Tripel aus Nutzerinput vor `requirePermission` validiert werden muss. Übernehme das bereits bewährte Analytics-Muster (`assertAnalyticsScopeConsistency`) in einen allgemeinen, getesteten Guard, sofern dadurch kein Statuscode oder legitimer Zugriff verändert wird.

**Verify**: mindestens ein negativer Cross-Tenant-Test je Modul mit nutzerlieferbaren Scope-IDs.

## Test plan

- alle bestehenden API-Tests laufen unverändert weiter;
- je Route-Modul ein Smoke-Test über `buildApp` bestätigt die Registrierung;
- Tests für 401, 403, 404 und Scope-Mismatch bleiben pro kritischem Schreibpfad erhalten;
- `rg "app\\.(get|post|put|patch|delete)" apps/api/src/app.ts` findet nach Abschluss nur `/health` oder keine Fachrouten mehr.

## Done criteria

- [ ] `app.ts` ist auf Bootstrap und Registrierung begrenzt (Richtwert: unter 500 LoC).
- [ ] Keine externe API-Änderung und kein neuer Service-Role-Zugriff im Browser.
- [ ] API-Tests sind nach Domänen aufgeteilt und bestehen.
- [ ] `pnpm check` besteht.

## STOP conditions

- Ein Modul müsste einen Response-Vertrag ändern, um extrahiert zu werden.
- Ein Tenant-Check lässt sich nicht ohne Semantikänderung zentralisieren.
- Ein Schritt verlangt das gleichzeitige Umstrukturieren einer Migration.

## Maintenance notes

Neue Endpunkte gehören sofort in das fachlich passende Modul; `app.ts` darf keine neuen Domänenrouten mehr aufnehmen. Reviewer prüfen insbesondere Reihenfolge von Hooks, Fehler-Mapping und Service-Role-Grenzen.
