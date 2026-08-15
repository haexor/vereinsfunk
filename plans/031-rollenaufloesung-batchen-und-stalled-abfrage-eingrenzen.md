# Plan 031: Rollenauflösung batchen und die Stalled-Abfrage serverseitig eingrenzen

> **Executor instructions**: Dieses Dokument vollständig lesen, die Schritte in Reihenfolge ausführen und nach jedem Schritt verifizieren. Bei einer STOP-Bedingung anhalten und berichten. Danach den Status dieses Plans im Index (`plans/README.md`) aktualisieren.
>
> **Drift check (run first)**: `git diff --stat f835434f..HEAD -- apps/api/src/auth.ts apps/api/src/routes/members.ts apps/api/src/routes/policies.ts apps/api/src/app.test.ts supabase/migrations`

## Status

- **Priority**: P2 — Performance/Skalierbarkeit, keine Sicherheits- oder Korrektheitslücke; beide Punkte laufen heute korrekt, nur mit unnötig vielen Datenbank-Roundtrips.
- **Effort**: M
- **Risk**: MEDIUM — Schritt 1 ändert eine gemeinsam genutzte Schnittstelle (`RoleProvider`), die von mehreren Testdoubles implementiert wird; Schritt 2 fügt eine neue, RLS-tragende View/Abfrage über Freigabedaten ein.
- **Depends on**: 027 (PR #36) — der betroffene Code liegt in den dort extrahierten Modulen `routes/members.ts`/`routes/policies.ts`.
- **Category**: performance, tech-debt
- **Planned at**: commit `f835434f`, 2026-08-10, aus dem CodeRabbit-Review zu PR #36 (siehe `project_paket_027_pr36_review_fix` im Gedächtnis) — dort als „Heavy lift“ bewusst zurückgestellt, damit sie nicht vergessen werden.

## Why this matters

Zwei vom Code-Review zu PR #36 gefundene, aber nicht behobene Muster:

1. **`GET /v1/organizations/:id/members`** löst die Capability-Felder (`canChangeRole`/`canRemove`/`canSetExpiry`) je eindeutiger Ebene über `roleProvider.rolesForScope` auf — einmal für die Organisation, einmal je eindeutiger Abteilung, einmal je eindeutigem Team. Bei 10 Abteilungen und 40 Teams sind das 51 Funktionsaufrufe, die aber wegen der internen Struktur von `SupabaseRoleProvider.rolesForScope` (jeder Aufruf mit `departmentId`+`teamId` fragt zusätzlich erneut `organization_memberships` und `department_memberships` ab, siehe „Current state“) tatsächlich deutlich mehr als 51 Einzel-Queries erzeugen. `Promise.all` startet sie alle gleichzeitig, ohne Obergrenze — ein Verein mit vielen Teams kann damit den Verbindungspool der Datenbank belasten und die Antwortzeit der Mitgliederliste verschlechtern.
2. **`GET /v1/approval-requests/stalled`** lädt mit `fetchAllRows` erst **alle** `approval_requests` der Organisation (unbegrenzt mit der Historie wachsend), danach alle offenen/festhängenden Stufen dazu, und reduziert das Ergebnis erst im Anwendungsspeicher auf „tatsächlich festhängend“. Nur ein kleiner Bruchteil (offene, überfällige oder invalidierte Anfragen) ist je relevant.

Beide Funde sind reale, aber architektonische Änderungen (neue Schnittstellenmethode bzw. neue SQL-View/RPC) und wurden deshalb bewusst nicht im Rahmen des reinen Review-Fix-Durchgangs zu PR #36 mit erledigt.

## Current state

- `apps/api/src/auth.ts:21-89` — `RoleProvider`-Interface mit genau einer Methode `rolesForScope(auth, scope)`; `SupabaseRoleProvider.rolesForScope` fragt bei jedem Aufruf `organization_memberships` unbedingt ab, `department_memberships` nur wenn `scope.departmentId` gesetzt ist, `team_memberships` nur wenn `scope.teamId` gesetzt ist — pro Aufruf, ohne Wiederverwendung über mehrere Aufrufe hinweg.
- `apps/api/src/routes/members.ts:104-119` — `rolesByScopeKey`-Aufbau: ein `rolesForScope`-Aufruf für die Organisation, dann `Promise.all` über je einen Aufruf pro eindeutiger `departmentId` (Scope `{organizationId, departmentId}`) und pro eindeutiger `teamId` (Scope `{organizationId, departmentId, teamId}` — der Team-Aufruf trägt bewusst auch `departmentId`, siehe `toPermissionScope`, damit `canAssignRole`/`canRemoveRole` korrekt kaskadieren).
- Mindestens neun Stellen in `apps/api/src/app.test.ts` implementieren `RoleProvider` als reines Objektliteral mit nur `rolesForScope` (`grantingRoleProvider`, `denyingRoleProvider`, `organizationManagerRoleProvider`, `ownerRoleProvider`, mehrere `socialManagerRoleProvider`, `directoryReaderRoleProvider`, `noAnalyticsViewRoleProvider`) — eine als Pflichtmethode ergänzte Batch-Funktion bricht sie alle.
- `apps/api/src/routes/policies.ts:941-960` (`GET /v1/approval-requests/stalled`) — lädt über `fetchAllRows` sämtliche `approval_requests` einer Organisation, filtert danach über `fetchAllRowsForIds` auf `approval_stages` mit Status `open`/`stalled`, und reduziert erst in TypeScript auf `invalidated_at !== null || overdue`.
- RLS-Grundlage der beiden Tabellen: `approval_requests_select` (`supabase/migrations/202608020001_initial_tenant_foundation.sql:420`, erweitert in `supabase/migrations/2026080606_policies_and_review_routes.sql:445` und `supabase/migrations/2026081002_review_route_reresolution.sql:890`) und `approval_stages_select` (`supabase/migrations/2026080606_policies_and_review_routes.sql:475`) — beide für `authenticated`, Vereinsmitglieder mit passender Rolle/Zuständigkeit dürfen lesen.
- `supabase/config.toml:13` — Postgres 17 (unterstützt `security_invoker`-Views seit PG 15 vollständig).
- Bestehende Tests: `apps/api/src/app.test.ts:1240` („derives per-role capability fields from the actor's own rank (Paket 023)“), `apps/api/src/app.test.ts:1879` („lists only stalled approval requests -- overdue or invalidated, not the merely open one“).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| API typecheck | `pnpm --filter @vereinsfunk/api typecheck` | exit 0 |
| API tests | `pnpm --filter @vereinsfunk/api test` | exit 0, 263+ Tests bestehen |
| DB reset | `pnpm db:reset` | exit 0, lokale DB migriert |
| RLS/SQL tests | `pnpm db:test` | exit 0 |
| Full gate | `pnpm check` | exit 0 |

## Scope

**In scope**

- `apps/api/src/auth.ts` — `RoleProvider`-Interface um eine optionale Batch-Methode erweitern, `SupabaseRoleProvider` implementiert sie effizient.
- `apps/api/src/routes/members.ts` — Capability-Auflösung auf die Batch-Methode umstellen.
- `apps/api/src/routes/policies.ts` — `/v1/approval-requests/stalled` auf eine serverseitig vorgefilterte Abfrage umstellen.
- neue additive Migration unter `supabase/migrations/` (View oder RPC) samt pgTAP-Test unter `supabase/tests/`.
- `apps/api/src/app.test.ts` — neue Regressionstests für beide Änderungen; bestehende Tests dürfen nur soweit angepasst werden, wie die Umstellung es zwingend erfordert (z. B. neue Mock-Methoden auf `RoleProvider`-Testdoubles).

**Out of scope**

- keine Änderung an `canAssignRole`/`canRemoveRole`/der Rang-Logik selbst.
- keine Änderung an `/v1/approval-stages/mine` (Paginierung dort bereits in PR #36 gefixt).
- kein request-übergreifendes Caching von Rollen (Ergebnisse bleiben auf die Dauer einer einzelnen Antwort beschränkt — projektweite Regel, keine neue Ausnahme hier einführen).
- keine Migration von `RoleProvider`-Konsumenten außerhalb von `members.ts` auf die neue Batch-Methode; andere Aufrufer (z. B. `requirePermission` selbst) bleiben unverändert, solange sie nur einen Scope pro Aufruf brauchen.

## Steps

### Step 1: `RoleProvider` um eine Batch-Methode erweitern

Ergänze `apps/api/src/auth.ts`s `RoleProvider`-Interface um eine **optionale** Methode, z. B. `rolesForScopes?(auth: { userId: string; accessToken: string }, scopes: readonly PermissionScope[]): Promise<ReadonlyMap<string, readonly Role[]>>` (Schlüssel: ein stabiler String pro Scope, z. B. `organization` / `department:<id>` / `team:<id>`, wiederverwendbar für den bestehenden `rolesByScopeKey`-Aufbau in `members.ts`). **Optional**, damit die neun bestehenden `RoleProvider`-Testdoubles in `app.test.ts` (siehe „Current state“) nicht brechen.

Implementiere `SupabaseRoleProvider.rolesForScopes` mit genau drei Abfragen unabhängig von der Anzahl der Scopes: eine `organization_memberships`-Abfrage für den Nutzer (immer), eine `department_memberships`-Abfrage mit `.in('department_id', <eindeutige IDs>)`, eine `team_memberships`-Abfrage mit `.in('team_id', <eindeutige IDs>)` — jeweils zusätzlich nach `user_id`/Ablauf gefiltert wie im bestehenden `rolesForScope`. Gruppiere die Ergebnisse danach in TypeScript in die zurückgegebene Map.

Ergänze in `apps/api/src/auth.ts` (oder `routes/shared.ts`, falls das dem bestehenden Muster für domänenübergreifende Helfer besser entspricht) eine kleine Fallback-Funktion, die `rolesForScopes` verwendet, wenn der übergebene `RoleProvider` sie implementiert, und sonst auf `Promise.all(scopes.map(s => roleProvider.rolesForScope(auth, s)))` zurückfällt — damit Testdoubles ohne die neue Methode weiter funktionieren, nur ohne den Geschwindigkeitsvorteil.

Stelle `apps/api/src/routes/members.ts:104-119` auf diese Fallback-Funktion um: ein Aufruf mit der Organisation plus allen eindeutigen Abteilungs- und Team-Scopes statt der bisherigen `Promise.all`-Kette.

**Verify**: `pnpm --filter @vereinsfunk/api typecheck && pnpm --filter @vereinsfunk/api test` → bestehender Test „derives per-role capability fields from the actor's own rank (Paket 023)“ (Zeile 1240) besteht unverändert; neuer Test bestätigt, dass bei einer `SupabaseRoleProvider`-Instanz mit N Abteilungen/Teams genau 3 Tabellenabfragen ausgeführt werden (Zähler im Test-Fake wie beim bereits existierenden `requestedChunkSizes`-Muster in Zeile 1205).

### Step 2: `/v1/approval-requests/stalled` serverseitig eingrenzen

Lege eine neue, additive Migration an, die eine `security_invoker`-View (bevorzugt gegenüber einer `security definer`-RPC, siehe Begründung unten) auf `approval_requests` und `approval_stages` definiert und ausschließlich Zeilen zurückgibt, die „mindestens eine offene/festhängende Stufe hat UND (diese Stufe ist überfällig ODER die Anfrage ist invalidiert)“ erfüllen. Explizit `security_invoker = true` setzen (PG 17, siehe „Current state“), damit die View mit den Rechten der aufrufenden Rolle läuft und `approval_requests_select`/`approval_stages_select` weiterhin greifen — **keine** `security definer`-Funktion, die selbst Berechtigungen nachbilden müsste (Projektregel: jede sicherheitsrelevante Herleitung serverseitig, nie vom Aufrufer übernommen — hier reicht die bestehende RLS, keine neue Vertrauensgrenze nötig).

Ersetze in `apps/api/src/routes/policies.ts:941-960` das Laden aller `approval_requests` samt anschließender In-Memory-Filterung durch eine `client.from('<neue View>').select(...).eq('organization_id', query.organizationId)`-Abfrage (weiterhin über `fetchAllRows` paginiert und mit `.order('id', { ascending: true })`, falls die View mehr als eine Seite liefern kann). Behalte die anschließende Anreicherung mit `posts`/`post_versions` unverändert bei.

**Verify**: `pnpm db:reset && pnpm db:test` → neuer pgTAP-Test bestätigt, dass die View für eine offene, nicht überfällige Stufe nichts liefert, für eine überfällige oder invalidierte Anfrage die Zeile liefert, und dass ein Nutzer ohne Sicht auf eine fremde Organisation (RLS) dort nichts sieht. `pnpm --filter @vereinsfunk/api test` → bestehender Test „lists only stalled approval requests…“ (Zeile 1879) besteht unverändert.

### Step 3: Dokumentation nachziehen

Aktualisiere `plans/README.md` (Tabelle „Vierte Serie“, Status dieses Plans) und trage in `plans/027-api-route-module-boundaries.md` einen Verweis ein, falls dort die beiden zurückgestellten Funde noch referenziert werden.

**Verify**: `pnpm check` → exit 0.

## Test plan

- Mitgliederliste mit 10 Abteilungen/40 Teams: `SupabaseRoleProvider.rolesForScopes` führt genau 3 Abfragen aus, unabhängig von der Anzahl der Scopes; Ergebnis (Capability-Felder je Zeile) identisch zum bisherigen Verhalten.
- Ein Testdouble, das nur `rolesForScope` implementiert (bestehende neun Stellen in `app.test.ts`), funktioniert unverändert über den Fallback.
- Stalled-Route: offene, nicht überfällige Stufe erscheint nicht; überfällige offene Stufe erscheint mit `isOverdue: true`; invalidierte Anfrage erscheint unabhängig vom Stufenstatus; eine Anfrage einer fremden Organisation erscheint nicht.
- Stalled-Route lädt nicht mehr sämtliche `approval_requests` der Organisation vorab — durch einen Zähler im Test-Fake nachweisen (analog zum Muster in Schritt 1).

## Done criteria

- [x] `SupabaseRoleProvider` löst eine Mitgliederliste mit beliebig vielen Abteilungen/Teams in konstant 3 Abfragen auf.
- [x] `GET /v1/approval-requests/stalled` lädt serverseitig nur potenziell festhängende Anfragen, nicht mehr die gesamte Organisation.
- [x] Alle bestehenden `RoleProvider`-Testdoubles kompilieren und laufen unverändert.
- [x] `pnpm check`, `pnpm db:reset` und `pnpm db:test` bestehen.

## Abschluss (2026-08-15)

Beide Punkte wie geplant umgesetzt, keine Abweichungen vom Scope.

**Schritt 1**: `RoleProvider.rolesForScopes` als optionale Methode (`apps/api/src/auth.ts`), `permissionScopeKey` als geteilter Schlüsselbildner. `SupabaseRoleProvider.rolesForScopes` fragt `organization_memberships` immer ab, `department_memberships`/`team_memberships` nur wenn die jeweilige ID-Menge nicht leer ist (nie mehr als 3, oft weniger) — die Rollen kaskadieren wie beim bestehenden `rolesForScope` (eine Team-Ebene trägt Org- und Abteilungs- und Team-Rollen). `resolveRolesForScopes` (`routes/shared.ts`) ist der im Plan vorgesehene Fallback: ruft `rolesForScopes` auf, wenn vorhanden, sonst `Promise.all(rolesForScope)` — alle neun bestehenden `RoleProvider`-Testdoubles brauchten keine Änderung. `routes/members.ts` baut jetzt eine flache Scope-Liste (Organisation + je eindeutiger Abteilung/Team) und ruft `resolveRolesForScopes` einmal auf, statt selbst `Promise.all` zu verketten.

Eine Abweichung von der Plan-Skizze: `SupabaseRoleProvider` bekam einen zusätzlichen optionalen `clientFactory`-Konstruktorparameter (Default `createUserClient`, identisches Injektionsmuster wie `jwksFetch` bei `createAuthGuards`) — nötig, um die geforderte "genau 3 Abfragen"-Zählung direkt an der Klasse zu testen, ohne eine echte Supabase-Instanz zu brauchen und ohne als erste Datei im Projekt `vi.mock` einzuführen (bislang mockt keine API-Testdatei ein ganzes Modul, alle DI-Seams sind Konstruktor-/Funktionsparameter).

**Schritt 2**: Migration `2026081501_stalled_approval_requests_view.sql` legt `public.stalled_approval_requests` als `security_invoker`-View an (erste View im Projekt) — join aus `approval_requests`/`approval_stages`, gefiltert auf Stufen mit Status `open`/`stalled`, `having` auf "invalidiert ODER mindestens eine Stufe überfällig". `GET /v1/approval-requests/stalled` (`routes/approvals.ts`) fragt jetzt direkt diese View ab statt erst alle `approval_requests` zu laden und in TypeScript zu filtern; `isOverdue` kommt direkt aus der View-Spalte `is_overdue`. Neuer pgTAP-Test `supabase/tests/stalled_approval_requests_view.test.sql` (6 Assertions): offene nicht-überfällige Stufe erscheint nicht, überfällige und invalidierte Anfrage erscheinen mit korrekten Flags, ein Mitglied eines fremden Vereins sieht nichts (RLS bleibt über `security_invoker` wirksam).

`pnpm check` (lint/typecheck/test/build aller 21 Pakete) und `pnpm db:reset && pnpm db:test` (775 pgTAP-Assertions über 27 Dateien) bestehen.

## STOP conditions

- Die neue View kann `security_invoker` nicht nutzen (z. B. weil eine Ziel-Postgres-Version darunter läuft) — dann zuerst klären, ob eine `security definer`-RPC mit vollständig nachgebauter Rechteprüfung vertretbar ist, statt RLS stillschweigend zu umgehen.
- Die Batch-Rollenauflösung würde eine andere Antwort liefern als die bisherige Einzelauflösung (z. B. durch einen Fehler in der Gruppierung) — Korrektheit hat Vorrang vor der Optimierung, in dem Fall anhalten statt mit abweichendem Verhalten zu committen.

## Maintenance notes

Der Fallback-Pfad (Schritt 1) ist bewusst dauerhaft, nicht nur eine Übergangslösung — er hält `RoleProvider` einfach für jeden Aufrufer, der nur einen einzelnen Scope braucht, und erspart es, jedes Testdouble anzufassen. Künftige Aufrufer mit demselben N+1-Muster (mehrere Scopes derselben Anfrage) sollten dieselbe Fallback-Funktion verwenden statt eigene `Promise.all`-Ketten zu schreiben.
