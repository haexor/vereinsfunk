# Prompt für die nächste Session

Alles unter der Trennlinie in eine neue Claude-Code-Session kopieren. Die Pläne selbst liegen in `plans/008`–`plans/025`, der Index in [plans/README.md](README.md).

---

Wir setzen die Planserie aus `plans/README.md` fort. Lies zuerst `plans/README.md` vollständig — dort stehen Reihenfolge, übergreifende Regeln, Rückbau-Inventar und offene Entscheidungen. Danach `AGENTS.md` und `docs/product/implementation-plan.md`.

**Du darfst und sollst Subagents und Workflows benutzen.** Die Pläne sind breit, viele Prüfungen laufen unabhängig voneinander.

## Stand

Erledigt: **008, 009, 010, 022, 023, 011, 012, 013, 014, 019, 015, 025, 020, 016**. Paket 016 (Auswertung: interne Kennzahlen) ist fachlich fertig, ein Review-Fix-Durchgang zu 15 CodeRabbit-Funden ist bereits gepusht (Commit `c300cbcd`). **Prüfe zuerst, ob PR #28 gemergt ist** (`gh pr view 28`, Branch `worktree-plan-016-auswertung-interne-kennzahlen`) — falls CodeRabbit auf den Review-Fix-Commit noch einmal reagiert hat, das zuerst durchgehen.

Daneben läuft unabhängig von der Plan-Serie **PR #29**: kleiner Bugfix — Erscheinungsbild-Speicherfehler im Onboarding (drei fehlende Pflichtfelder im Payload von Schritt 3) plus Entfernung der wirkungslosen Tonalität-Auswahl aus dem Onboarding-Formular. Branch `worktree-onboarding-tonalitaet-entfernen`. Stand prüfen, bevor an `marke.vue` oder dem Onboarding gearbeitet wird, sonst doppelte Arbeit.

## Empfehlung für das nächste Paket

Keiner der beiden verbleibenden Kandidaten ist ohne Rückfrage baubar:

- **021 (Abomodelle, Speicherkontingent)** — technisch bereit (009, 010, 011 erledigt), braucht aber vorab mehrere Geschäfts-/Steuerentscheidungen vom Nutzer (Zahlungsdienstleister, Preise/Deckungsrechnung, Bestandspreise, Video im kostenlosen Tarif).
- **024 (Freigaberoute neu auflösen)** — Entwurf steht (`plans/024-freigaberoute-neu-aufloesen.md`), aber noch nicht vom Nutzer bestätigt.

**Frag gezielt nach, bevor du eines der beiden baust.** 017 und 018 bleiben an externen Gates (Meta App Review bzw. Rechtsgrundlage/AVV mit LLM-Anbieter) hängen.

## Was 016 mitbringt (Auswertung: interne Kennzahlen)

- **Vier live berechnende Endpunkte** (`GET /v1/analytics/summary|timeseries|breakdown|funnel`) — kein Cache, keine Vorberechnung. `packages/domain/src/metrics.ts` trägt die reinen Rechenfunktionen, inklusive `computeCountMetricsSeries` (Review-Fix: ersetzt eine quadratische Bucket-Schleife im API-Handler durch einen einmalig sortierten Zeiger-Ansatz, O(Ereignisse·log Ereignisse + Buckets) statt O(Buckets·Ereignisse)).
- **Neue Tabelle `post_status_events`** (Statushistorie, per Trigger auf `posts` befüllt) plus neue Aufbewahrungsregel `retention_settings.status_event_days` (Default 730 Tage), durchgesetzt im bestehenden Retention-Lauf.
- **Neue Seite `pages/auswertung.vue`**: Kennzahlenzeile mit Trend, handgerolltes SVG (keine neue Chart-Bibliothek), Aufschlüsselung nach Abteilung/Anlass/Ziel, Funnel, Kontingentauslastung, ehrlich benannter Leerbereich für Reichweite/Interaktionen (kommt erst mit 017).
- **Fünfter kritischer Befund der adversarialen Prüfung, projektweit relevant** (siehe `plans/README.md`, Abschnitt „Kritischster Befund"): `apps/api/src/auth.ts`s `rolesForScope` prüft Organisation-/Abteilungs-/Team-Mitgliedschaft unabhängig voneinander, nie ob die drei per Scope übergebenen IDs überhaupt zusammengehören. In 016 behoben über `assertAnalyticsScopeConsistency`, der gemeinsame `RoleProvider` selbst bewusst unverändert gelassen. **Andere Endpunkte mit demselben Query-Parameter-Muster (`toPermissionScope(organizationId, departmentId)` aus rohen Query-Parametern, danach eine Abfrage nur nach `organizationId` statt zusammengesetzt gefiltert) könnten betroffen sein — noch nicht geprüft.**
- **Review-Fix (Commit `c300cbcd`)**: 15 CodeRabbit-Funde zu PR #28 behoben — u. a. die oben genannte quadratische Bucket-Schleife, `.in()`-Batching in drei Loadern, 404 statt 500 bei fehlender Organisation, Custom-Zeitraum-Validierung und Watcher-Race-Conditions in der Oberfläche, sechs Dokument-Inkonsistenzen im Plan (Cache-Abschnitte als verworfen markiert, Kachel-Zuordnung von 019 auf 009 korrigiert, Metrikdefinitionen-Tabelle auf tatsächliche Granularität gebracht). Ein Fund (Kontingent-RPC-Parallelität) bewusst zurückgestellt — von CodeRabbit selbst als trivial/low-value markiert.
- **Bewusst nicht behoben, dokumentiert**: `workflow_runs` hat kein `team_id` — ein `team_manager` ohne eigene Abteilungsrolle sieht Workflow-Zählwerte der gesamten Abteilung statt nur des eigenen Teams. Kein Scope-Wähler auf der Auswertungsseite selbst (Scope kommt wie überall aus der Sidebar).

## Kritische Punkte, projektweit relevant (aus 016 und 025, weiterhin gültig)

- **Scope-Konsistenz bei zusammengesetzten IDs** (016): jeder Endpunkt, der `organizationId`/`departmentId`/`teamId` aus rohen Query-Parametern zu einem `PermissionScope` zusammensetzt, muss vor der Rechteprüfung sicherstellen, dass die IDs tatsächlich zusammengehören (nicht nur, dass der Aufrufer irgendeine Rolle in jeder einzelnen hat) — sonst lässt sich eine echte Rolle in Verein A mit einer beliebigen ID aus Verein B kombinieren. `assertAnalyticsScopeConsistency` in `apps/api/src/app.ts` ist die Referenzimplementierung; noch nicht auf andere Endpunkte mit demselben Muster übertragen.
- **Ein an anderer Stelle gelesener, aber nie geschriebener Wert legt die erwartete Form fest — nicht die „korrekte" Verschachtelung des Quelltyps** (025): `effective_config_snapshot` wurde bis 025 von niemandem beschrieben, aber von zwei Stellen (`schedule_publication`, `available-channels`) bereits mit einer bestimmten (flachen) Formannahme gelesen. Bei jeder Spalte, die von A geschrieben und von B (an anderer Stelle, früher gebaut) gelesen wird, ohne dass es bisher einen Schreibzugriff gab: die tatsächliche Lesestelle prüfen, nicht nur den Typ des Schreibers.

## Bewusst offen gelassene Punkte (unverändert seit 011/012/014/015/025/020, plus 016)

- `submit_requires_permission` existiert als Spalte, hat aber keine Bedeutung (011).
- Benachrichtigung der Prüfer, der tägliche „Stufen als stalled markieren"-Job, `recompute_directory_minor_status()` (014), `flag_channels_needing_reconnect()`/`cleanup_expired_oauth_state()` (012), Retention-Lauf und Audit-Signatur (020) — alle warten weiterhin auf den Hatchet-Cron aus Paket 004, der weiterhin nicht produktiv läuft.
- Eine tatsächlich blockierte Freigaberoute lässt sich noch nicht auflösen — Paket 024 (Entwurf, noch nicht bestätigt).
- `request_approval` prüft weiterhin nicht, ob die vom Aufrufer genannten Prüfer die in der Richtlinie **konfigurierten** sind (`plans/024-freigaberoute-neu-aufloesen.md`, Abschnitt 2).
- `evaluateMediaGate`/`computeMediaGateBlockersForPostVersion` bleiben rein informativ für Reviewer, nicht als echter Blocker in `decide_approval_stage`/`schedule_publication` verdrahtet.
- Der UI-Trigger für `request_approval` fehlt in `erstellen.vue` — `freigaben.vue` bleibt deshalb leer, bis dieser Trigger gebaut wird.
- Kein Hatchet-Cron, der eine künftig geplante Veröffentlichung automatisch ausführt — `POST /v1/publications/:id/execute` bleibt ein expliziter, manueller Trigger.
- Vollständige, irreversible Vereinskonto-Löschung fehlt (020).
- `workflow_runs` hat kein `team_id` — ein `team_manager` sieht Workflow-Zählwerte der gesamten Abteilung statt nur des eigenen Teams (016).
- Der gemeinsame `RoleProvider` (`apps/api/src/auth.ts`) ist nicht gegen das Scope-Konsistenz-Muster aus 016 geprüft, außer am neuen Analytics-Endpunkt.

## Vorgehen je Arbeitspaket

Arbeite **ein Paket zu Ende**, bevor du das nächste anfängst.

### Phase 1 — Plan gegen den Code verifizieren (parallel)

Pläne zitieren konkrete `file:line`-Stellen. Vor dem Bauen mehrere Agents parallel prüfen lassen, ob diese Aussagen noch stimmen — pro Agent ein Abschnitt „Ausgangslage und Evidenz", Meldung je Behauptung: bestätigt, verschoben, oder falsch. Weicht etwas ab: zuerst den Plan aktualisieren und mir sagen, was sich geändert hat, bevor gebaut wird.

### Phase 2 — Umsetzen

`EnterWorktree` vor der ersten Codeänderung, ein Branch je Paket. **Nach `EnterWorktree` jeden absoluten Dateipfad mit dem zurückgegebenen Worktree-Präfix schreiben, nicht den Hauptcheckout-Pfad aus Gewohnheit weiterverwenden** — das ist in dieser Serie bereits dreimal versehentlich passiert (015, 020, 016: ein Plan-Update aus Phase 1 landete im Hauptcheckout statt im Worktree und blieb dort unstaged liegen, bis es beim nächsten Session-Start entdeckt und verworfen wurde). Migration → Domain → API → Oberfläche → Rückbau ist überwiegend seriell. Parallelisierbar: reine Domainfunktionen mit Tests sobald das Modell feststeht, pgTAP-Tests parallel zur Migration, Oberflächenarbeit sobald die Contracts fest sind. **Nicht** parallel: zwei Agents an derselben Migrationsdatei, an `packages/contracts/src/index.ts` oder `packages/domain/src/index.ts`.

**Env-Dateien für den manuellen Browser-Test liegen an der Worktree-WURZEL, nicht in `apps/api/`**: `apps/api/package.json`s `dev`-Skript lädt `../../.env` relativ zum `apps/api`-Arbeitsverzeichnis — das ist die Worktree-Wurzel (zwei Ebenen höher), nicht `apps/api/.env`.

### Phase 3 — Adversarial prüfen (parallel, unterschiedliche Blickwinkel)

1. **Mandantentrennung** — `organization_id` auf jeder neuen Tabelle, zusammengesetzte Fremdschlüssel, positive **und** negative RLS-Tests. Bei jeder neuen `security definer`-RPC: übernimmt sie sicherheitsrelevante Parameter vom Aufrufer? Bei jeder neuen RLS-Policy mit `EXISTS`/`JOIN`: unterliegt der Aufrufer dabei der Policy der abgefragten Tabelle? Bei jeder service-role-Löschung anhand einer Pfad-/Referenzspalte ohne CHECK: kann ein Aufrufer im eigenen Verein diese Spalte auf ein fremdes Ziel zeigen lassen (siehe 020s Cross-Tenant-Fund)? Bei jedem Endpunkt, der `organizationId`/`departmentId`/`teamId` aus Query-Parametern zu einem Scope zusammensetzt: sind die IDs auf Zusammengehörigkeit geprüft, nicht nur einzeln auf eine Rolle (siehe 016s Scope-Konsistenz-Fund)?
2. **Rechte** — kommt jemand an Aktionen/Daten, die der Plan ausdrücklich verwehrt? Bekommt jede Rolle, die laut Plan etwas verwalten soll, die dafür nötige Permission auch tatsächlich in **beiden** Permission-Tabellen (TS und SQL)?
3. **Geheimnisse** — Token, Elternkontakt, Einwilligungsnachweise, Provenienz-Felder: landen sie in einem `select` für `authenticated`, der breiter ist als nötig?
4. **Verträge** — jede Systemgrenze mit Zod, Grenzfälle abgedeckt, jeder SQL-Fehlerpfad auf einen sinnvollen HTTP-Status gemappt (nicht nur ein generischer 500 bei einem CHECK-Verstoß, siehe 020).
5. **Rückbau** — jeder Inventar-Eintrag erledigt, kein erfundener Wert durch Null/Platzhalter ersetzt. Bei jeder in der Oberfläche behaupteten Frist/Zusage: existiert dafür tatsächlich Code, der sie einhält (dieselbe Fehlerklasse wie ursprünglich bei 020s Auslöser, seitdem bereits einmal in 020 selbst wiederholt bei `consent_evidence_years`)?
6. **Gelesen-vor-geschrieben** — bei jeder Spalte, die von einer neuen Stelle erstmals BESCHRIEBEN wird, aber von einer älteren Stelle bereits GELESEN wird: die tatsächliche Lesestelle prüfen, nicht nur den Typ nachbilden (siehe „Kritische Punkte" oben).

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
- Chirurgische Änderungen: nur anfassen, was das Paket verlangt. Kein Refactoring angrenzenden Codes, kein Aufräumen fremden toten Codes — nur erwähnen. Wird durch die eigene Änderung Code ungenutzt (z. B. ein DI-Slot ohne verbleibenden Aufrufer), diesen aber entfernen statt tote Infrastruktur zurückzulassen.
- Minimaler Code. Keine Abstraktion für einen einzigen Aufrufer, keine ungefragte Konfigurierbarkeit.
- Neue Laufzeitabhängigkeiten vor dem Festlegen kurz auf bekannte CVEs prüfen (`pnpm audit`).
- Commits und PR-Beschreibungen ohne jeden Hinweis auf Claude, Anthropic oder Claude Code.
- Deutsch in Produkttexten, Plänen und Commit-Messages. Code, Bezeichner und SQL bleiben englisch.
- Bei echten Mehrdeutigkeiten fragen, nicht raten. Bei eindeutigen Aufgaben direkt umsetzen.
- Design-Entscheidungen, die sich beim Bauen als nötig erweisen, im Plan selbst dokumentieren statt still anzuwenden.
- Squash-Merges ändern die Commit-SHA auf `main`. Vor dem Erstellen einer PR für ein neues Paket prüfen, ob die eigene Branch-Historie noch auf dem echten `main` aufsetzt (`git merge-base --is-ancestor origin/main HEAD`) — sonst zeigt die PR den Diff des bereits gemergten Vorgänger-Pakets erneut.
- Commit und PR nur nach ausdrücklicher Aufforderung des Nutzers — die Umsetzung eines Pakets allein ist keine implizite Freigabe dafür.

## Offene Entscheidungen

`plans/README.md` listet sie am Ende. Für 021 wird mindestens eine Entscheidung gebraucht, für 024 eine Bestätigung:

- **021 (Abomodelle)**: alles, was Geld betrifft — Zahlungsdienstleister, Preise/Deckungsrechnung, Bestandspreise, Video im kostenlosen Tarif.
- **024 (Freigaberoute neu auflösen)**: Entwurf steht, noch nicht bestätigt.
- **011 (weiterhin ungeklärt)**: automatische Eskalation an die übergeordnete Ebene nach Fristablauf einer blockierten Prüfstufe — nur eine automatische *Freigabe* ist ausgeschlossen, eine Eskalation nicht.
- **010 (falls E-Mail-Versand noch nicht entschieden ist)**: eigener Anbieter oder Supabase Auth Invite.

Frag gezielt nach, statt eine Annahme zu treffen.
