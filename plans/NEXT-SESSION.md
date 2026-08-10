# Prompt für die nächste Session

## Aktueller Refactoring-Stand (2026-08-09)

- Paket 030 ist umgesetzt: bei verbotener Selbstfreigabe enthält der Reviewer-Snapshot den Autor nicht mehr; Domain-Tests decken auch die Minderjährigenstufe ab.
- Paket 028 ist teilweise umgesetzt: `apps/web/app/composables/useApiClient.ts` zentralisiert Browser-API-Zugriffe. Migriert sind `kanaele.vue`, `einstellungen/recht.vue` und die Ladepfade von `mitglieder.vue`.
- Ausgelagerte Komponenten: `LegalAuditChain.vue`, `ProcessorAgreements.vue`, `BrandLivePreview.vue`.
- `apps/api/src/apiMappers.ts` enthält die aus `app.ts` gezogenen Mapper und Brand-/Einladungshelfer; `app.ts` bleibt weiterhin der große nächste Refactoring-Block.
- Letzte erfolgreiche Prüfungen: Web-Typecheck und Web-Tests, API-/Domain-Tests sowie ein vollständiger Workspace-Check vor den letzten Web-Schritten. Vor neuen Änderungen immer erneut passend zum Scope prüfen.
- Noch offen: Paket 028 vollständig abschließen (vor allem `marke.vue`, `mitglieder.vue`, `integrationen.vue`), dann 027 (Routenmodule) und 029 (Contracts/Domain-Aufteilung). Bestehende uncommittete Änderungen des Refactoring-PRs bewahren.

Alles unter der Trennlinie in eine neue Claude-Code-Session kopieren. Die Pläne selbst liegen in `plans/008`–`plans/025`, der Index in [plans/README.md](README.md).

---

Wir setzen die Planserie aus `plans/README.md` fort. Lies zuerst `plans/README.md` vollständig — dort stehen Reihenfolge, übergreifende Regeln, Rückbau-Inventar und offene Entscheidungen. Danach `AGENTS.md` und `docs/product/implementation-plan.md`.

**Du darfst und sollst Subagents und Workflows benutzen.** Die Pläne sind breit, viele Prüfungen laufen unabhängig voneinander.

## Stand

Erledigt: **008, 009, 010, 022, 023, 011, 012, 013, 014, 019, 015, 025, 020, 016, 024**. Paket 016 (PR #28) und Paket 024 sind beide fertig gebaut, verifiziert und gemergt. Nur noch **021 (Abomodelle, Speicherkontingent)** bleibt aus der zweiten Planserie offen — technisch bereit, braucht aber vorab mehrere Geschäfts-/Steuerentscheidungen vom Nutzer (siehe unten). 017 und 018 bleiben an externen Gates (Meta App Review bzw. Rechtsgrundlage/AVV mit LLM-Anbieter) hängen.

## Empfehlung für das nächste Paket

**021 ist der einzige verbleibende Kandidat der zweiten Planserie — frag gezielt nach den unten gelisteten Geschäftsentscheidungen, bevor du baust.** Ist keine davon klärbar, prüfe stattdessen, ob eines der externen Gates (017/018) inzwischen offen ist, oder ob der Nutzer ein Paket aus der dritten Ebene (Plattform-Administration, siehe `plans/README.md`) oder einen eigenständigen Bugfix priorisiert.

## Was 024 mitbringt (Freigaberoute bewusst neu auflösen)

- **`authz.resolve_review_route`**: baut `buildStageDefinitions`/`resolveReviewRoute` (bislang nur TS, `apps/api`/`packages/domain`) in SQL nach — Grundlage dafür, dass `request_approval` und die neue `reresolve_approval_route` die Freigaberoute seit diesem Paket **ausschließlich selbst** ableiten, nie mehr vom Aufrufer übernehmen.
- **`request_approval` mitgehärtet**: kein `stages`-Parameter mehr (alte Zwei-Parameter-Signatur per `drop function` entfernt). Schließt die seit Paket 011 offene, bereits ausgelieferte Lücke, dass ein Einreichender per direktem RPC-Aufruf einen selbst gewählten Prüfer — auch für die Minderjährigenstufe — hätte eintragen können, obwohl `review_mode = 'named'` etwas anderes verlangt.
- **`public.reresolve_approval_route`**: der Ausweg aus einer festhängenden Freigabe (Prüferin ausgetreten, Frist überschritten, Medium geändert). Verwaltungsrecht (`department.manage`) im Scope, Autor ausgeschlossen, Begründung ab zehn Zeichen Pflicht, vorheriger Zustand in neuer Tabelle `approval_route_changes` festgehalten (redigierte Projektion ohne Prüfer-IDs), `invalidated_at` bekommt damit erstmals Wirkung (`authz.can_decide_stage` lehnt eine invalidierte Freigabe jetzt ab, `reresolve_approval_route` ist der Weg zurück).
- **API**: `POST /v1/approval-requests/:id/reresolve`, `GET /v1/approval-requests/stalled` (festhängende Freigaben der eigenen Ebene — deckt überfällig/invalidiert ab, **nicht** den dritten Plan-Auslöser „reviewer_snapshot nicht mehr erfüllbar", siehe Plan), `approval_route_changes`-Verlauf in `GET /v1/post-versions/:id/approval`.
- **Oberfläche**: neuer Abschnitt „Festhängende Freigaben deiner Ebene" auf `pages/freigaben.vue` mit Neuauflösen-Aktion.
- **Sieben Funde beim Bauen, alle durch tatsächliche Ausführung (nicht nur Lesen) gefunden**, darunter ein **vorbestehender, seit Paket 011 nie ausgeführter Bug**: `decide_approval_stage`s Zuweisung an `posts.status` bei `rejected`/`changes_requested` scheiterte mit einem SQL-Typfehler (500) bei **jeder** Ablehnung, weil ein `CASE` mit reinen Text-Literalen in einem `UPDATE ... SET` nicht implizit auf den Enum-Zielspaltentyp castet — unbemerkt, weil kein bisheriger Test diesen Pfad gegen echtes Postgres ausgeführt hat. Vollständige Liste in `plans/024-freigaberoute-neu-aufloesen.md`, Abschnitt „Umsetzung: Ergebnis und Abweichungen vom Plan".
- **Projektweit relevant**: `approval_requests_select`/`approval_stages_select`/`approval_route_changes_select` deckten vor diesem Paket nur Organisationsrolle, zugewiesene Prüfer und den Autor ab — eine Person mit `department.manage`, die selbst weder Prüfer noch Autor ist, konnte eine Anfrage ihrer eigenen Abteilung nicht einmal per `SELECT` finden. Alle drei Policies um eine `department.manage`-Klausel erweitert. Wer künftig eine neue RLS-Policy für `approval_requests`/`approval_stages` schreibt, muss diese Klausel mitführen.
- **Regel für künftige `RETURNS TABLE`-Funktionen**: eine Ausgabespalte, deren Name mit einer im Funktionskörper gelesenen Tabellenspalte kollidiert (hier: `scope`), wird als PL/pgSQL-Variable verdeckt und macht jede unqualifizierte Referenz mehrdeutig — immer tabellenqualifizieren.

## Kritische Punkte, projektweit relevant (aus 016/024/025, weiterhin gültig)

- **Scope-Konsistenz bei zusammengesetzten IDs** (016): jeder Endpunkt, der `organizationId`/`departmentId`/`teamId` aus rohen Query-Parametern zu einem `PermissionScope` zusammensetzt, muss vor der Rechteprüfung sicherstellen, dass die IDs tatsächlich zusammengehören. `assertAnalyticsScopeConsistency` in `apps/api/src/app.ts` ist die Referenzimplementierung; noch nicht auf andere Endpunkte mit demselben Muster übertragen.
- **Ein an anderer Stelle gelesener, aber nie geschriebener Wert legt die erwartete Form fest** (025): bei jeder Spalte, die von A geschrieben und von B (an anderer Stelle, früher gebaut) gelesen wird, ohne dass es bisher einen Schreibzugriff gab: die tatsächliche Lesestelle prüfen, nicht nur den Typ des Schreibers.
- **CASE mit reinen Text-Literalen und Enum-Zielspalten** (024): in einem `UPDATE ... SET enum_col = CASE WHEN ... THEN 'a' ELSE 'b' END` ohne expliziten Cast löst Postgres den CASE auf `text` auf, nicht auf den Zielspaltentyp — anders als bei einem einzelnen Literal oder (beobachtet) einem `INSERT ... VALUES`. Immer `::public.<enum_type>` ergänzen, wenn ein CASE mit mehreren String-Literal-Zweigen an eine Enum-Spalte zugewiesen wird.

## Bewusst offen gelassene Punkte (unverändert seit 011/012/014/015/020/025, plus 016/024)

- `submit_requires_permission` existiert als Spalte, hat aber keine Bedeutung (011).
- Benachrichtigung der Prüfer, der tägliche „Stufen als stalled markieren"-Job, `recompute_directory_minor_status()` (014), `flag_channels_needing_reconnect()`/`cleanup_expired_oauth_state()` (012), Retention-Lauf und Audit-Signatur (020) — alle warten weiterhin auf den Hatchet-Cron aus Paket 004, der weiterhin nicht produktiv läuft. Benachrichtigung neu benannter Prüfer nach einer Neuauflösung (024) fällt in dieselbe Kategorie.
- `evaluateMediaGate`/`computeMediaGateBlockersForPostVersion` bleiben rein informativ für Reviewer, nicht als echter Blocker in `decide_approval_stage`/`schedule_publication` verdrahtet.
- Der UI-Trigger für `request_approval` fehlt weiterhin in `erstellen.vue` — `freigaben.vue`s „wartet auf mich"-Liste bleibt deshalb meist leer, und der in 024 gebaute `approval_route_changes`-Verlauf in `GET /v1/post-versions/:id/approval` hat noch keine Detailseite, die ihn anzeigt (derselbe fehlende Trigger).
- `GET /v1/approval-requests/stalled` (024) deckt nur zwei der drei geplanten Auslöser ab (überfällig, invalidiert) — „reviewer_snapshot nicht mehr erfüllbar" (`unresolvableReviewers`) fehlt, siehe Plan.
- Kein Hatchet-Cron, der eine künftig geplante Veröffentlichung automatisch ausführt — `POST /v1/publications/:id/execute` bleibt ein expliziter, manueller Trigger.
- Vollständige, irreversible Vereinskonto-Löschung fehlt (020).
- `workflow_runs` hat kein `team_id` — ein `team_manager` sieht Workflow-Zählwerte der gesamten Abteilung statt nur des eigenen Teams (016).
- Der gemeinsame `RoleProvider` (`apps/api/src/auth.ts`) ist nicht gegen das Scope-Konsistenz-Muster aus 016 geprüft, außer am Analytics-Endpunkt.

## Vorgehen je Arbeitspaket

Arbeite **ein Paket zu Ende**, bevor du das nächste anfängst.

### Phase 1 — Plan gegen den Code verifizieren (parallel)

Pläne zitieren konkrete `file:line`-Stellen. Vor dem Bauen mehrere Agents parallel prüfen lassen, ob diese Aussagen noch stimmen — pro Agent ein Abschnitt „Ausgangslage und Evidenz", Meldung je Behauptung: bestätigt, verschoben, oder falsch. Weicht etwas ab: zuerst den Plan aktualisieren und mir sagen, was sich geändert hat, bevor gebaut wird.

### Phase 2 — Umsetzen

`EnterWorktree` vor der ersten Codeänderung, ein Branch je Paket. **Nach `EnterWorktree` jeden absoluten Dateipfad mit dem zurückgegebenen Worktree-Präfix schreiben, nicht den Hauptcheckout-Pfad aus Gewohnheit weiterverwenden** — das ist in dieser Serie bereits dreimal versehentlich passiert (015, 020, 016). Migration → Domain → API → Oberfläche → Rückbau ist überwiegend seriell. Parallelisierbar: reine Domainfunktionen mit Tests sobald das Modell feststeht, pgTAP-Tests parallel zur Migration, Oberflächenarbeit sobald die Contracts fest sind. **Nicht** parallel: zwei Agents an derselben Migrationsdatei, an `packages/contracts/src/index.ts` oder `packages/domain/src/index.ts`.

**Bei jeder neuen PL/pgSQL-Funktion, die tatsächliche Logik enthält (nicht nur eine einfache Abfrage): vor dem Weiterbauen einmal ausführen** (`pnpm db:reset` + ein pgTAP-Aufruf oder ein Testfall), nicht nur `db:reset` allein — Postgres prüft einen PL/pgSQL-Funktionskörper syntaktisch/semantisch erst bei der ersten Ausführung, nicht beim Anlegen. Paket 024 hat allein dadurch sieben echte Fehler gefunden, die `db:reset` durchgelassen hätte (mehrdeutige Spaltennamen, fehlende Enum-Casts, eine Fensterfunktion in einer Aggregatfunktion, ein vorbestehender, nie ausgeführter Bug in bereits produktivem Code).

**Env-Dateien für den manuellen Browser-Test liegen an der Worktree-WURZEL, nicht in `apps/api/`**: `apps/api/package.json`s `dev`-Skript lädt `../../.env` relativ zum `apps/api`-Arbeitsverzeichnis — das ist die Worktree-Wurzel (zwei Ebenen höher), nicht `apps/api/.env`.

### Phase 3 — Adversarial prüfen (parallel, unterschiedliche Blickwinkel)

1. **Mandantentrennung** — `organization_id` auf jeder neuen Tabelle, zusammengesetzte Fremdschlüssel, positive **und** negative RLS-Tests. Bei jeder neuen `security definer`-RPC: übernimmt sie sicherheitsrelevante Parameter vom Aufrufer? Bei jeder neuen RLS-Policy mit `EXISTS`/`JOIN`: unterliegt der Aufrufer dabei der Policy der abgefragten Tabelle? Bei jeder service-role-Löschung anhand einer Pfad-/Referenzspalte ohne CHECK: kann ein Aufrufer im eigenen Verein diese Spalte auf ein fremdes Ziel zeigen lassen (siehe 020s Cross-Tenant-Fund)? Bei jedem Endpunkt, der `organizationId`/`departmentId`/`teamId` aus Query-Parametern zu einem Scope zusammensetzt: sind die IDs auf Zusammengehörigkeit geprüft (siehe 016s Scope-Konsistenz-Fund)?
2. **Rechte** — kommt jemand an Aktionen/Daten, die der Plan ausdrücklich verwehrt? Bekommt jede Rolle, die laut Plan etwas verwalten soll, die dafür nötige Permission auch tatsächlich in **beiden** Permission-Tabellen (TS und SQL)? Kann eine verwaltende Person eine Zeile per RPC überhaupt referenzieren, oder fehlt ihr dafür die RLS-Sichtbarkeit (siehe 024s Fund zu `approval_requests_select`)?
3. **Geheimnisse** — Token, Elternkontakt, Einwilligungsnachweise, Provenienz-Felder: landen sie in einem `select` für `authenticated`, der breiter ist als nötig?
4. **Verträge** — jede Systemgrenze mit Zod, Grenzfälle abgedeckt, jeder SQL-Fehlerpfad auf einen sinnvollen HTTP-Status gemappt (nicht nur ein generischer 500 bei einem CHECK-Verstoß, siehe 020).
5. **Rückbau** — jeder Inventar-Eintrag erledigt, kein erfundener Wert durch Null/Platzhalter ersetzt.
6. **Gelesen-vor-geschrieben** — bei jeder Spalte, die von einer neuen Stelle erstmals BESCHRIEBEN wird, aber von einer älteren Stelle bereits GELESEN wird: die tatsächliche Lesestelle prüfen, nicht nur den Typ nachbilden.

Ein Fund gilt erst als echt, wenn reproduzierbar. Unklare Funde von einem zweiten Agent widerlegen lassen.

### Phase 4 — Manueller Browser-Test bei UI-Änderungen

`run-web`-Skill nutzen. `apps/api` und `apps/web` brauchen dafür ein eigenes `.env` im Worktree — **`.env` gehört an die Worktree-Wurzel** (siehe Phase 2). **Nicht** das `.env` aus dem Haupt-Checkout kopieren: es enthält echte Secrets. Stattdessen die nötigen Werte neu schreiben — lokale Supabase-Adressen/-Schlüssel aus `supabase status -o json`, für `SECRET_BOX_KEYS`/`SECRET_BOX_CURRENT_KEY_VERSION`/`CONSENT_RESPONSE_HASH_PEPPER` frische Wegwerfwerte. Nach dem Test löschen. **Vor dem Start prüfen, ob Port 4200/4201 schon belegt sind** (`lsof -ti:4200/4201 -sTCP:LISTEN`) — auch von einem stehen gebliebenen Server aus einem anderen Worktree.

## Definition of Done je Paket

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Bei Datenbankänderungen zusätzlich:

```bash
pnpm db:start && pnpm db:reset && pnpm db:test
```

Alles muss grün sein. Danach Statuswert in `plans/README.md` auf `erledigt` setzen, Rückbau-Inventar abhaken, abhängige Pläne (die auf dieses Paket verweisen) mit dem tatsächlichen Ergebnis aktualisieren.

## Verbindliche Regeln

- `AGENTS.md` gilt: jede mandantenbezogene Tabelle mit `organization_id`, zusammengesetzte Fremdschlüssel, RLS mit positiven und negativen Tests, Service Role nur in API und Workern, Provider nur hinter Interfaces, Zod an jeder Systemgrenze.
- Übergreifende Regeln in `plans/README.md` sind bindend.
- **Kein erfundener Wert wird durch eine Null oder einen grauen Balken ersetzt.**
- Chirurgische Änderungen: nur anfassen, was das Paket verlangt. Kein Refactoring angrenzenden Codes, kein Aufräumen fremden toten Codes — nur erwähnen. Wird durch die eigene Änderung Code ungenutzt (z. B. ein DI-Slot ohne verbleibenden Aufrufer), diesen aber entfernen statt tote Infrastruktur zurückzulassen. Ein beim Bauen entdeckter, echter vorbestehender Bug in Code, den das Paket ohnehin per `create or replace` neu fasst, darf mitbehoben werden (siehe 024s `decide_approval_stage`-Fund) — aber nur dort, nicht als Anlass für ein größeres Refactoring.
- Minimaler Code. Keine Abstraktion für einen einzigen Aufrufer, keine ungefragte Konfigurierbarkeit.
- Neue Laufzeitabhängigkeiten vor dem Festlegen kurz auf bekannte CVEs prüfen (`pnpm audit`).
- Commits und PR-Beschreibungen ohne jeden Hinweis auf Claude, Anthropic oder Claude Code.
- Deutsch in Produkttexten, Plänen und Commit-Messages. Code, Bezeichner und SQL bleiben englisch.
- Bei echten Mehrdeutigkeiten fragen, nicht raten. Bei eindeutigen Aufgaben direkt umsetzen.
- Design-Entscheidungen, die sich beim Bauen als nötig erweisen, im Plan selbst dokumentieren statt still anzuwenden.
- Squash-Merges ändern die Commit-SHA auf `main`. Vor dem Erstellen einer PR für ein neues Paket prüfen, ob die eigene Branch-Historie noch auf dem echten `main` aufsetzt (`git merge-base --is-ancestor origin/main HEAD`) — sonst zeigt die PR den Diff des bereits gemergten Vorgänger-Pakets erneut.
- Commit und PR nur nach ausdrücklicher Aufforderung des Nutzers — die Umsetzung eines Pakets allein ist keine implizite Freigabe dafür.

## Offene Entscheidungen

`plans/README.md` listet sie am Ende. Für 021 wird mindestens eine Entscheidung gebraucht:

- **021 (Abomodelle)**: alles, was Geld betrifft — Zahlungsdienstleister, Preise/Deckungsrechnung, Bestandspreise, Video im kostenlosen Tarif.
- **011 (weiterhin ungeklärt)**: automatische Eskalation an die übergeordnete Ebene nach Fristablauf einer blockierten Prüfstufe — nur eine automatische *Freigabe* ist ausgeschlossen, eine Eskalation nicht. Seit 024 ist der manuelle Ausweg (Neuauflösung durch eine verwaltende Person) gebaut; eine zusätzliche automatische Eskalation bleibt eine separate, noch offene Frage.
- **010 (falls E-Mail-Versand noch nicht entschieden ist)**: eigener Anbieter oder Supabase Auth Invite.

Frag gezielt nach, statt eine Annahme zu treffen.
