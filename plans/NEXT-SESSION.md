# Prompt für die nächste Session

Alles unter der Trennlinie in eine neue Claude-Code-Session kopieren. Die Pläne selbst liegen in `plans/008`–`plans/024`, der Index in [plans/README.md](README.md).

---

Wir setzen die Planserie aus `plans/README.md` fort. Lies zuerst `plans/README.md` vollständig — dort stehen Reihenfolge, übergreifende Regeln, Rückbau-Inventar und offene Entscheidungen. Danach `AGENTS.md` und `docs/product/implementation-plan.md`.

**Du darfst und sollst Subagents und Workflows benutzen.** Die Pläne sind breit, viele Prüfungen laufen unabhängig voneinander.

## Stand

Erledigt: **008, 009, 010, 022, 023, 011, 012, 013, 014, 019**. Paket 019 ist als PR #23 offen (Branch `worktree-plan-019-mannschaften-spielplaene-und-veranstaltungen`, korrekt auf dem aktuellen `main` nach den Merges von PR #21/#22 rebast) — **prüfe zuerst, ob er gemergt ist** (`gh pr view 23`). Falls nicht: entweder auf den Merge warten oder für das nächste Paket von diesem Branch statt von `main` abzweigen, falls `packages/club-schedule`, `fixtures`/`club_events`, `factsFromFixture`/`factsFromClubEvent` oder die neuen Permissions `fixture.manage`/`event.manage` direkt weiterverwendet werden. **Offener Punkt aus 019 selbst**: der manuelle Browser-Test der drei geänderten Oberflächenseiten (Kalender-Ebenen, Anlass-Vorbelegung in `erstellen.vue`, Anlassvorschläge-Karte im Dashboard) wurde in der letzten Sitzung nicht mehr durchgeführt — sollte vor oder unmittelbar nach dem Merge nachgeholt werden (`run-web`-Skill).

**Empfehlung für das nächste Paket**: **015** (Einwilligungsverwaltung — hängt an 002 und 014, beide erledigt bzw. `directory_people` steht bereit) oder **016** (Auswertung — seit 011 möglich, trifft aber sofort auf die Inhalts-Pipeline-Lücke unten). **021** (Abomodelle) ist ebenfalls seit 011 möglich, braucht aber vorab mehrere Geld-Entscheidungen. Vor 015 wird deine Entscheidung zu „Einwilligungstext je Verein oder global" und zur Aufbewahrungsfrist gebraucht.

## Was 019 mitbringt (Mannschaften, Spielpläne, Ergebnisse und Veranstaltungen)

- **`packages/club-schedule`**: drei Bereichsadapter (`teams`, `fixtures`, `events`) auf dem Rahmen aus 014, nach demselben Muster wie `packages/member-directory`. `detectFixtureTitle()` erkennt aus einem freien iCal-Titel („SV Nordstadt – TSV Süd 3:1“) Spielmuster inkl. Ergebnis, ohne Team-Namen mit Bindestrich fälschlich zu splitten. Mannschaftszuordnung („wer sind wir“) löst erst der Resolver in `fixtureMatch.ts` — ein iCal-Titel ohne aufzulösende Seite wird `unknown_structure`-Konflikt, nie eine Vermutung.
- **`fixtures`/`club_events`**: neue Tabellen, vereinsweit sichtbar (`authz.is_any_member_of_organization`, anders als das engere `directory_people`), Schreibzugriff ausschließlich über die API mit Service Role (wie `directory_people`, nicht wie `teams`). Zwei neue Permissions `fixture.manage`/`event.manage`, dupliziert TS/SQL, nur `department_admin`.
- **`factsFromFixture`/`factsFromClubEvent`** (`packages/content-engine/src/schedule.ts`): pure Funktionen, die aus einem Spiel/einer Veranstaltung die Fakten für die Beitragserstellung vorbelegen, inklusive Herkunftsnachweis (`FactProvenance`) und einer pauschalen Regel: unbekanntes Heimrecht blockiert die Vorbelegung immer, auch wenn `match_announcement` es selbst nicht bräuchte (Vereinfachung, siehe Plan).
- **TZID-Auflösung** in `packages/integrations/src/icalTransport.ts` (`resolveIcalDateTime`) — korrekt über Sommerzeit- und Zonengrenzen, per doppelter `Intl.DateTimeFormat`-Umrechnung, keine eigene Zeitzonendatenbank.
- **API**: Sync-Endpunkt um `teams`/`fixtures`/`events` erweitert (eigene Handler-Funktionen `handleTeamsSync`/`handleFixturesSync`/`handleEventsSync`, gemeinsame Helfer `buildPendingConflicts`/`handleAbortedSync`/`finishSyncRun`); `GET .../fixtures`/`.../club-events`; drei Dismiss-Endpunkte; `GET /v1/departments/:id/content-suggestions` (drei von vier Anlassvorschlag-Regeln, zustandslos berechnet, kein Cron); `POST /v1/submissions` um `fixtureId`/`clubEventId` erweitert, Herkunft leitet die API selbst her.
- **Oberfläche**: `kalender.vue` mit drei Ebenen (Beiträge/Spiele/Veranstaltungen, Lücken ohne Beitrag verlinkt direkt in die Erstellung), `erstellen.vue` mit automatischer Vorbelegung über `?fixtureId=`/`?clubEventId=`, Anlassvorschläge-Karte im Dashboard mit Dismiss-Aktion.
- **Bewusst nicht gebaut**: der vierte Anlassvorschlag „Kontingent unausgeschöpft" (bräuchte dieselbe periodengenaue Kontingentberechnung wie `schedule_publication`); kein manueller CRUD-Endpunkt für `fixtures`/`club_events` (Korrektur läuft über die 014-Konfliktauflösung); kein Team-Filter im Kalender (nur der bestehende globale Abteilungs-Scope-Umschalter); die optionale „oder wähle einen Anlass“-Dropdown in `erstellen.vue`.
- **Bekannte, dokumentierte Inkonsistenz**: `handleTeamsSync`/`handleFixturesSync`/`handleEventsSync` legen die `integration_sync_runs`-Zeile erst am Ende an (Erfolg/Abbruch), nicht vorab wie der seit der 014-Review-Fix-PR gehärtete `people`-Pfad (Lauf vor dem ersten Schreibvorgang anlegen, bei Fehler auf `failed` setzen). Ein Fehler mitten in einem `apply`-Lauf für diese drei Domänen hinterlässt deshalb keine Spur. Nicht in 019 nachgezogen — nächster naheliegender Schritt für einen künftigen Refactor.
- **Sync-Änderungsvergleich ungenau bei iCal-Quellen**: `fixtureMatch.ts`s `fieldsOf()` vergleicht eine bereits aufgelöste UTC-ISO-Zeichenkette (lokal) gegen die noch rohe iCal-Kompaktform (extern) — ein wiederholter Lauf ohne echte Änderung zählt `kickoff_at` deshalb bei iCal-Quellen jedes Mal als „aktualisiert“. Harmlos (kein Datenverlust, derselbe Wert wird erneut geschrieben), aber die Trockenlauf-/Anwenden-Zusammenfassung ist für diesen einen Fall ungenau.

## Kritischer Punkt, projektweit relevant (ergänzt die Funde aus 011/012/013/014)

Zwei neue, in 019 selbst gefundene Muster, zusätzlich zu den bereits dokumentierten:

**Eine neue Permission, die im Rollenmodell existiert, aber an keiner tatsächlichen Durchsetzungsstelle geprüft wird, ist so gut wie keine Permission.** `fixture.manage`/`event.manage` wurden bei der Migration angelegt (TS und SQL, wie vorgeschrieben), aber der Sync-Endpunkt prüfte anfangs nur `integration.manage` — beim eigenen Review vor Abschluss gefunden und behoben. Bei jeder neuen Permission: nicht nur "existiert sie in beiden Tabellen", sondern "wird sie an der Stelle, die sie schützen soll, auch tatsächlich abgefragt" — eine Permission ohne `requirePermission`-Aufruf ist toter Code mit Sicherheitsanspruch.

**Ein an anderer Stelle behobener Fund gilt nicht automatisch für eine strukturell ähnliche, aber nicht identische Tabelle.** Die 014-Review-Fix-PR behob "eigene Quellzeile verschwindet aus `existing`, wenn ihre Abteilung gelöscht/sie umgehängt wird" für `directory_people`. `fixtures`/`club_events`/`teams` sehen strukturell ähnlich aus (Abteilungsbindung, Quellenbindung), haben aber eine andere FK-Löschregel (`on delete cascade` statt `on delete set null`) und keinen Schreibpfad, der `department_id` nachträglich ändert — die Ausgangslage für den Fund existiert dort nicht. Vor dem blinden Übertragen eines Fixes: prüfen, ob die Voraussetzung, die ihn nötig machte, in der neuen Tabelle überhaupt vorliegt.

## Die Inhalts-Pipeline fehlt weiterhin

Unverändert seit 011/012/014: kein Code erzeugt einen `post`/eine `post_version` aus einer `submission`. `POST /v1/submissions` akzeptiert seit 019 zusätzlich `fixtureId`/`clubEventId`, persistiert Herkunft — aber der Weg zu einem tatsächlichen `post` bleibt derselbe fehlende Baustein aus 001–007. Wer **016** umsetzt, trifft weiterhin auf denselben fehlenden Funnel.

## Offener sicherheitsrelevanter Punkt aus 011 (weiterhin ungeklärt)

`request_approval` prüft nicht, ob die vom Aufrufer genannten Prüfer die in der Richtlinie **konfigurierten** sind. `plans/024-freigaberoute-neu-aufloesen.md`, Abschnitt 2. **Vor 024 zu klären, und vor dem ersten echten Verein mit Minderjährigen-Inhalten** — was mit 019 (echte Klarnamen minderjähriger Spieler in Spielankündigungen möglich) nochmals näher gerückt ist.

## Bewusst offen gelassene Punkte (unverändert seit 011/012/014, plus 019)

- `submit_requires_permission` existiert als Spalte, hat aber keine Bedeutung (011).
- Benachrichtigung der Prüfer, der tägliche „Stufen als stalled markieren“-Job, `recompute_directory_minor_status()`, `flag_channels_needing_reconnect()`/`cleanup_expired_oauth_state()` — fertige Funktionen, warten auf den Hatchet-Cron aus Paket 004.
- Eine tatsächlich blockierte Freigaberoute lässt sich noch nicht auflösen — Paket 024.
- `sync-integration-source` bleibt in `WorkflowNameSchema` reserviert, aber nicht verdrahtet — jeder Sync-Lauf (Personen, Mannschaften, Spiele, Veranstaltungen) läuft weiterhin synchron in der API-Anfrage.
- Der vierte Anlassvorschlag „Kontingent unausgeschöpft" (019) — braucht dieselbe Kontingentberechnung wie `schedule_publication`.
- Der Run-Lifecycle-Nachweis bei Fehlern (Lauf vorab anlegen, bei Fehler `failed`) gilt seit der 014-Review-Fix-PR nur für die `people`-Domäne, nicht für `teams`/`fixtures`/`events` (019).

## Vorgehen je Arbeitspaket

Arbeite **ein Paket zu Ende**, bevor du das nächste anfängst.

### Phase 1 — Plan gegen den Code verifizieren (parallel)

Pläne zitieren konkrete `file:line`-Stellen. Vor dem Bauen mehrere Agents parallel prüfen lassen, ob diese Aussagen noch stimmen — pro Agent ein Abschnitt „Ausgangslage und Evidenz“, Meldung je Behauptung: bestätigt, verschoben, oder falsch. Weicht etwas ab: zuerst den Plan aktualisieren und mir sagen, was sich geändert hat, bevor gebaut wird.

### Phase 2 — Umsetzen

`EnterWorktree` vor der ersten Codeänderung, ein Branch je Paket. Migration → Domain → API → Oberfläche → Rückbau ist überwiegend seriell. Parallelisierbar: reine Domainfunktionen mit Tests sobald das Modell feststeht, pgTAP-Tests parallel zur Migration, Oberflächenarbeit sobald die Contracts fest sind. **Nicht** parallel: zwei Agents an derselben Migrationsdatei, an `packages/contracts/src/index.ts` oder `packages/domain/src/index.ts`.

**Vor dem Push/der PR-Erstellung**: prüfen, ob der eigene Branch noch auf dem aktuellen `origin/main` aufsetzt (`git log --oneline origin/main -3` gegen die eigene Basis) — andere Sitzungen können zwischenzeitlich Pakete gemergt haben, wie es bei 019 selbst geschah (014 wurde während der Umsetzung von 019 gemergt, inklusive einer eigenen Review-Fix-Nachfolge-PR). Im Zweifel `git rebase --onto origin/main <alter-Basis-Commit> HEAD`, danach die komplette Definition of Done erneut prüfen — ein Rebase kann automatisch gemergte Konflikte enthalten, die sich nur durch erneutes Ausführen der Tests zeigen, nicht durch die reine Abwesenheit von Merge-Konflikt-Markierungen.

### Phase 3 — Adversarial prüfen (parallel, unterschiedliche Blickwinkel)

1. **Mandantentrennung** — `organization_id` auf jeder neuen Tabelle, zusammengesetzte Fremdschlüssel, positive **und** negative RLS-Tests. Bei jeder neuen `security definer`-RPC: übernimmt sie sicherheitsrelevante Parameter vom Aufrufer? Bei jeder neuen RLS-Policy mit `EXISTS`/`JOIN`: unterliegt der Aufrufer dabei der Policy der abgefragten Tabelle? Bei jeder Funktion, die eine Ressource auf Scope X prüft, aber Referenzen aus einem breiteren Pool auflöst: ist der Pool selbst auf Scope X beschränkt (Fund aus 014)?
2. **Rechte** — kommt jemand an Aktionen/Daten, die der Plan ausdrücklich verwehrt? Bekommt jede Rolle, die laut Plan etwas verwalten soll, die dafür nötige Permission tatsächlich in **beiden** Tabellen (TS und SQL)? **Wird jede neue Permission an der Stelle, die sie schützen soll, auch tatsächlich per `requirePermission` abgefragt** (Fund aus 019 — eine Permission ohne Durchsetzungsstelle ist toter Code)?
3. **Geheimnisse** — Token, Elternkontakt, Einwilligung, Provenienz-Felder: landen sie in einem `select` für `authenticated`, der breiter ist als nötig? Landet ein falsch zugeordnetes Feld ungeprüft in einer schwächer geschützten Tabelle?
4. **Verträge** — jede Systemgrenze mit Zod, Grenzfälle abgedeckt. **Bei jedem Boolean-Feld, das aus einem String-Wert (Query-Parameter, Multipart, Datei-Import) kommt: `z.coerce.boolean()` ist `Boolean(value)` und macht jeden nicht-leeren String wahr — `z.stringbool()` oder `z.union([z.boolean(), z.stringbool()])` verwenden** (wiederkehrender Fund aus 014 und 019).
5. **Rückbau** — jeder Inventar-Eintrag erledigt, kein erfundener Wert durch Null/Platzhalter ersetzt.
6. **Übertragbarkeit eines Fundes prüfen, nicht annehmen** — wenn eine ältere Sitzung einen Fund an Tabelle A behoben hat und die neue Arbeit eine strukturell ähnliche Tabelle B einführt: erst verifizieren, ob die Voraussetzung des Fundes (z. B. eine bestimmte FK-Löschregel, ein bestimmter Schreibpfad) bei B überhaupt vorliegt, bevor der Fix blind übertragen wird (Fund aus 019).

Ein Fund gilt erst als echt, wenn reproduzierbar. Unklare Funde von einem zweiten Agent widerlegen lassen.

### Phase 4 — Manueller Browser-Test bei UI-Änderungen

`run-web`-Skill nutzen. Nicht nur auf grüne Tests verlassen. `apps/api` braucht dafür ein eigenes `.env` im Worktree (aus dem Haupt-Checkout kopieren, `SECRET_BOX_KEYS`/`SECRET_BOX_CURRENT_KEY_VERSION` ergänzen, falls noch nicht vorhanden) — nach dem Test wieder löschen, ebenso `apps/web/.env`. **Für 019 selbst noch nicht durchgeführt** — falls PR #23 noch offen ist, gehört das nachgeholt, bevor er gemergt wird.

## Definition of Done je Paket

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Bei Datenbankänderungen zusätzlich:

```bash
pnpm db:start && pnpm db:reset && pnpm db:test
```

Alles muss grün sein. Danach Statuswert in `plans/README.md` auf `erledigt` setzen, Rückbau-Inventar abhaken, abhängige Pläne mit dem tatsächlichen Ergebnis aktualisieren.

## Verbindliche Regeln

- `AGENTS.md` gilt: jede mandantenbezogene Tabelle mit `organization_id`, zusammengesetzte Fremdschlüssel, RLS mit positiven und negativen Tests, Service Role nur in API und Workern, Provider nur hinter Interfaces, Zod an jeder Systemgrenze.
- Übergreifende Regeln in `plans/README.md` sind bindend.
- **Kein erfundener Wert wird durch eine Null oder einen grauen Balken ersetzt.**
- Chirurgische Änderungen: nur anfassen, was das Paket verlangt. Kein Refactoring angrenzenden Codes, kein Aufräumen fremden toten Codes — nur erwähnen.
- Minimaler Code. Keine Abstraktion für einen einzigen Aufrufer, keine ungefragte Konfigurierbarkeit. Ein an anderer Stelle gefundener Fix wird nicht blind auf eine strukturell ähnliche Tabelle übertragen, ohne zu prüfen, ob dessen Voraussetzung dort überhaupt vorliegt (Fund aus 019, siehe oben) — die naheliegende Übertragung kann unnötiger Code für ein Szenario sein, das nicht eintreten kann.
- Neue Laufzeitabhängigkeiten vor dem Festlegen kurz auf bekannte CVEs prüfen (`pnpm audit`).
- Ausgehende Abrufe einer vom Verein hinterlegten Adresse (Feed-URL, Webhook-Ziel, künftiger HTTP-Adapter) laufen ausschließlich über `apps/api/src/outboundFetch.ts` (`fetchPublicUrl`/`isAllowedOutboundUrl`) — nie ein nacktes `fetch()`. Geprüft wird beim Speichern der Adresse **und** bei jedem Abruf.
- Commits und PR-Beschreibungen ohne jeden Hinweis auf Claude, Anthropic oder Claude Code.
- Deutsch in Produkttexten, Plänen und Commit-Messages. Code, Bezeichner und SQL bleiben englisch.
- Bei echten Mehrdeutigkeiten fragen, nicht raten. Bei eindeutigen Aufgaben direkt umsetzen.
- Design-Entscheidungen, die sich beim Bauen als nötig erweisen, im Plan selbst dokumentieren statt still anzuwenden.
- Squash-Merges ändern die Commit-SHA auf `main`. Vor dem Erstellen einer PR für ein neues Paket prüfen, ob die eigene Branch-Historie noch auf dem echten `main` aufsetzt (`git log --oneline origin/main -3` gegen die eigene Historie) — andere Sitzungen mergen parallel, wie bei 019 selbst geschehen. Im Zweifel `git rebase --onto origin/main <alter-Basis-Commit> HEAD`, danach die komplette Definition of Done erneut ausführen, bevor gepusht/die PR erstellt wird.

## Offene Entscheidungen

`plans/README.md` listet sie am Ende. Für 015/016/021 wird jeweils mindestens eine Entscheidung gebraucht:

- **015 (Einwilligungsverwaltung)**: Einwilligungstext je Verein oder global, Aufbewahrungsfrist für Einwilligungsnachweise (Vorschlag: fünf Jahre ab Ende der Gültigkeit, gehört eigentlich zu 020).
- **021 (Abomodelle)**: alles, was Geld betrifft — Zahlungsdienstleister, Preise/Deckungsrechnung, Bestandspreise, Video im Free-Tarif.
- **010 (falls E-Mail-Versand noch nicht entschieden ist)**: eigener Anbieter oder Supabase Auth Invite.

Frag gezielt nach, statt eine Annahme zu treffen.
