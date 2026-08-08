# Prompt für die nächste Session

Alles unter der Trennlinie in eine neue Claude-Code-Session kopieren. Die Pläne selbst liegen in `plans/008`–`plans/025`, der Index in [plans/README.md](README.md).

---

Wir setzen die Planserie aus `plans/README.md` fort. Lies zuerst `plans/README.md` vollständig — dort stehen Reihenfolge, übergreifende Regeln, Rückbau-Inventar und offene Entscheidungen. Danach `AGENTS.md` und `docs/product/implementation-plan.md`.

**Du darfst und sollst Subagents und Workflows benutzen.** Die Pläne sind breit, viele Prüfungen laufen unabhängig voneinander.

## Stand

Erledigt: **008, 009, 010, 022, 023, 011, 012, 013, 014, 019, 015, 025**. Paket 025 ist neu und schließt eine seit den Plänen 001–007 (2026-08-02) dokumentierte, projektweite Lücke: kein Code hatte je einen `post`/eine `post_version` aus einer `submission` erzeugt. **Prüfe zuerst, ob die zugehörige PR gemergt ist** (Branch `worktree-plan-025-inhalts-pipeline-entwurf-und-veroeffentlichung`). Falls nicht: entweder auf den Merge warten oder für das nächste Paket von diesem Branch abzweigen, falls `postId`/`postVersionId` in der `POST /v1/submissions`-Antwort, `POST /v1/publications/:id/execute` oder `GET /v1/media-grants/:token` direkt weiterverwendet werden.

**Empfehlung für das nächste Paket**: **020 (Rechtliche Pflichten und Datenschutzbetrieb)** ist weiterhin das einzige Paket mit komplett erledigter Abhängigkeitskette (009, 012, 015) und wird mit jeder Sitzung dringlicher (echte Klarnamen seit 014, echte Einwilligungsnachweise seit 015). Alternativ **016 (Auswertung interne Kennzahlen)** — ab 011 möglich und trifft jetzt erstmals auf echte Beitragsdaten statt auf die vorher fehlende Pipeline. **021 (Abomodelle)** ist ebenfalls bereit, braucht aber vorab Geschäfts-/Steuerentscheidungen vom Nutzer — frag danach, bevor du baust.

## Was 025 mitbringt (Inhalts-Pipeline schließen: Entwurfserzeugung und Veröffentlichung ausführen)

- **Fünf parallele Recherche-Agents haben vor dem Bauen den tatsächlichen Stand von Plan 001–007 gegen den aktuellen Code verifiziert** (nicht gegen die auf `unborn HEAD` von 2026-08-02 geschriebenen, seither veralteten Baseline-Hashes). Ergebnis: Plan 001 (Inhaltsmodell) war im Kern längst über die Pakete 011/019 erledigt; Plan 002s Datenmodell (media_assets/face_regions/consent_records/media_derivatives/post_media/publications/publication_attempts/publication_media_grants) existierte bereits vollständig seit einer frühen, nie genutzten Migration; Plan 006s `MetaPublisher` machte bereits echte Graph-API-Calls, wurde aber nirgends aufgerufen. Der eine echte, fünffach bestätigte Bruchpunkt: `POST /v1/submissions` erzeugte nie einen `post`/eine `post_version` — `FakeContentGenerator` lieferte nur eine Vorschau, `FakeOrchestrator.trigger()` tat nichts, und selbst ein echter Hatchet-Worker hätte `context.enqueueDraft(...)` aufgerufen, eine Methode ohne jede Implementierung im ganzen Repository.
- **`POST /v1/submissions`** legt bei vollständigem Quellmaterial (keine `missingFacts`) jetzt echt `posts`/`post_versions`/`post_variants` an (Service Role, `status='draft_ready'`, `created_by_type='llm'`), ruft vorher `assertGroundedPost` auf (Plan 001s Grounding-Invariante, bisher definiert aber nie durchgesetzt) und gibt `postId`/`postVersionId` zurück.
- **`effective_config_snapshot` wird geflacht geschrieben** (`{config: {...top-level, ...policies}}`), nicht mit der unveränderten `EffectiveConfig`-Verschachtelung. Wichtig für jeden künftigen Schreibzugriff auf diese Spalte: `schedule_publication` und `GET /v1/post-versions/:id/available-channels` lesen bereits `config.allowedChannelIds` direkt — die naheliegende, "korrekte" Verschachtelung (`config.policies.allowedChannelIds`) hätte die Kanal-Beschränkung aus 011/012 beim ersten echten Schreibzugriff stillschweigend wirkungslos gemacht.
- **`orchestrator`/`FakeOrchestrator`/`priorityToHatchet` aus `apps/api/src/app.ts` entfernt** — war nur für den jetzt überflüssigen `process-submission`-Trigger da (einziger Aufrufer im ganzen File). `packages/orchestration` selbst bleibt unangetastet für einen späteren echten Aufrufer.
- **`POST /v1/publications/:id/execute`** (neu): führt eine fällige, bereits über `schedule_publication` (011/012) eingeplante Veröffentlichung tatsächlich aus — Compare-and-Set auf `status='uploading'`, Token-Entschlüsselung, Medien-Grant-Erzeugung, `SocialPublisher.validate()`/`.publish()`, `publication_attempts`-Aufzeichnung, Audit. Kein Hatchet-Cron verfügbar (Paket 004 weiterhin nicht produktiv) — explizit synchron ausgelöst, wie der bestehende `POST /v1/integration-sources/:id/sync`, kein automatisches Ausführen zu einem künftigen Zeitpunkt.
- **`GET /v1/media-grants/:token`** (neu): öffentliche, token-basierte Medienübergabe an Meta, nach demselben Muster wie die öffentlichen Einwilligungs-Token-Seiten aus 015.
- **Ohne die Upload-/Freigabepipeline (Pläne 002/003, weiterhin nicht gebaut) hat jede aus 025 entstehende `post_version` keine `post_media`-Zeilen** — `FakePublisher`/`MetaPublisher` lehnen eine Veröffentlichung ohne mindestens ein Medium unconditional ab, unabhängig von der Plattform. Ein echter Veröffentlichungsversuch schlägt deshalb korrekt mit 422 fehl. Das ist erwartetes Verhalten, keine Regression — der Mechanismus greift ohne weitere Anpassung, sobald 002/003 echte Derivate erzeugen.
- **Manuell im Browser verifiziert**: `erstellen.vue` → „Entwurf erstellen" erzeugt eine echte `post`/`post_version`-Zeile mit korrekt gesetztem `current_version_id` und vier `post_variants`-Zeilen (zwei Formate × zwei Plattformen).
- **Nebenbefund, bewusst nicht behoben**: `erstellen.vue`s „Zur Freigabe geben"-Button navigiert nur zu `/freigaben`, ruft `request_approval` nicht auf — dieser UI-Trigger fehlt weiterhin, unabhängig von 025. `freigaben.vue` bleibt deshalb auch jetzt leer, bis dieser Trigger gebaut wird; das erzeugte `post_versions`-Objekt selbst ist aber real und mit `request_approval` direkt nutzbar.

## Die Inhalts-Pipeline ist geschlossen (nicht mehr "fehlt weiterhin")

Anders als in jeder Sitzung seit 011/012/014/015/019 dokumentiert: `POST /v1/submissions` erzeugt jetzt echt einen `post`/eine `post_version`. Das bereits fertige Freigabegate (011/015) und der Kalender (019) sind damit erstmals mit echten Daten befüllbar. Was weiterhin fehlt: der UI-Trigger für `request_approval` (siehe oben) und die gesamte Medien-/Rendering-Kette (002/003/005) — ein `post_version` entsteht bislang nur textuell, ohne Bilder/Video.

## Kritischer Punkt, projektweit relevant (ergänzt 011/012/013/014/015)

**Ein an anderer Stelle gelesener, aber nie geschriebener Wert legt die erwartete Form fest — nicht die "korrekte" Verschachtelung des Quelltyps.** `effective_config_snapshot` wurde bis 025 von niemandem beschrieben, aber von zwei Stellen (`schedule_publication`, `available-channels`) bereits mit einer bestimmten (flachen) Formannahme gelesen. Der naive, typkonforme Ansatz (die tatsächliche `EffectiveConfig`-Verschachtelung 1:1 speichern) wäre kompiliert, hätte aber die bestehende Kanal-Beschränkung lautlos außer Kraft gesetzt. Bei jeder Spalte, die von A geschrieben und von B (an anderer Stelle, früher gebaut) gelesen wird, ohne dass es bisher einen Schreibzugriff gab: die tatsächliche Lesestelle prüfen, nicht nur den Typ des Schreibers.

## Bewusst offen gelassene Punkte (unverändert seit 011/012/014/015, plus 025)

- `submit_requires_permission` existiert als Spalte, hat aber keine Bedeutung (011).
- Benachrichtigung der Prüfer, der tägliche „Stufen als stalled markieren"-Job, `recompute_directory_minor_status()` (014), `flag_channels_needing_reconnect()`/`cleanup_expired_oauth_state()` (012), Ablauf-Erinnerung/Aufbewahrungslöschung für Einwilligungen (015) — alle warten weiterhin auf den Hatchet-Cron aus Paket 004, der weiterhin nicht produktiv läuft.
- Eine tatsächlich blockierte Freigaberoute lässt sich noch nicht auflösen — Paket 024.
- `request_approval` prüft weiterhin nicht, ob die vom Aufrufer genannten Prüfer die in der Richtlinie **konfigurierten** sind (`plans/024-freigaberoute-neu-aufloesen.md`, Abschnitt 2).
- `evaluateMediaGate`/`computeMediaGateBlockersForPostVersion` bleiben rein informativ für Reviewer, nicht als echter Blocker in `decide_approval_stage`/`schedule_publication` verdrahtet — bewusst außerhalb des mit dem Nutzer abgestimmten Umfangs von 025.
- `assertApprovalSnapshot` bleibt unverdrahtet — ohne echte Medien keine sinnvolle Grundlage.
- Der UI-Trigger für `request_approval` fehlt in `erstellen.vue` (siehe oben) — ein eigener, kleiner, nicht in 025 enthaltener Baustein.
- Kein Hatchet-Cron, der eine künftig geplante Veröffentlichung automatisch ausführt — `POST /v1/publications/:id/execute` bleibt ein expliziter, manueller Trigger, bis Paket 004 produktiv läuft.

## Vorgehen je Arbeitspaket

Arbeite **ein Paket zu Ende**, bevor du das nächste anfängst.

### Phase 1 — Plan gegen den Code verifizieren (parallel)

Pläne zitieren konkrete `file:line`-Stellen. Vor dem Bauen mehrere Agents parallel prüfen lassen, ob diese Aussagen noch stimmen — pro Agent ein Abschnitt „Ausgangslage und Evidenz", Meldung je Behauptung: bestätigt, verschoben, oder falsch. Weicht etwas ab: zuerst den Plan aktualisieren und mir sagen, was sich geändert hat, bevor gebaut wird. **Bei alten, seit Wochen ungeprüften Plänen (wie 001–007 vor Paket 025) lohnt sich das besonders** — vieles kann bereits durch spätere Pakete erledigt worden sein, ohne dass der ursprüngliche Plan das je vermerkt hat.

### Phase 2 — Umsetzen

`EnterWorktree` vor der ersten Codeänderung, ein Branch je Paket. **Nach `EnterWorktree` jeden absoluten Dateipfad mit dem zurückgegebenen Worktree-Präfix schreiben, nicht den Hauptcheckout-Pfad aus Gewohnheit weiterverwenden.** Migration → Domain → API → Oberfläche → Rückbau ist überwiegend seriell. Parallelisierbar: reine Domainfunktionen mit Tests sobald das Modell feststeht, pgTAP-Tests parallel zur Migration, Oberflächenarbeit sobald die Contracts fest sind. **Nicht** parallel: zwei Agents an derselben Migrationsdatei, an `packages/contracts/src/index.ts` oder `packages/domain/src/index.ts`.

**Env-Dateien für den manuellen Browser-Test liegen an der Worktree-WURZEL, nicht in `apps/api/`**: `apps/api/package.json`s `dev`-Skript lädt `../../.env` relativ zum `apps/api`-Arbeitsverzeichnis — das ist die Worktree-Wurzel (zwei Ebenen höher), nicht `apps/api/.env`. Beim Paket-025-Test führte das erst zu durchgängigen 401-Fehlern, bis die Datei an den richtigen Ort verschoben wurde.

### Phase 3 — Adversarial prüfen (parallel, unterschiedliche Blickwinkel)

1. **Mandantentrennung** — `organization_id` auf jeder neuen Tabelle, zusammengesetzte Fremdschlüssel, positive **und** negative RLS-Tests. Bei jeder neuen `security definer`-RPC: übernimmt sie sicherheitsrelevante Parameter vom Aufrufer? Bei jeder neuen RLS-Policy mit `EXISTS`/`JOIN`: unterliegt der Aufrufer dabei der Policy der abgefragten Tabelle?
2. **Rechte** — kommt jemand an Aktionen/Daten, die der Plan ausdrücklich verwehrt? Bekommt jede Rolle, die laut Plan etwas verwalten soll, die dafür nötige Permission auch tatsächlich in **beiden** Permission-Tabellen (TS und SQL)?
3. **Geheimnisse** — Token, Elternkontakt, Einwilligungsnachweise, Provenienz-Felder: landen sie in einem `select` für `authenticated`, der breiter ist als nötig?
4. **Verträge** — jede Systemgrenze mit Zod, Grenzfälle abgedeckt, jeder SQL-Fehlerpfad auf einen sinnvollen HTTP-Status gemappt.
5. **Rückbau** — jeder Inventar-Eintrag erledigt, kein erfundener Wert durch Null/Platzhalter ersetzt.
6. **Neu seit 025**: bei jeder Spalte, die von einer neuen Stelle erstmals BESCHRIEBEN wird, aber von einer älteren Stelle bereits GELESEN wird — die tatsächliche Lesestelle prüfen, nicht nur den Typ nachbilden (siehe "Kritischer Punkt" oben).

Ein Fund gilt erst als echt, wenn reproduzierbar. Unklare Funde von einem zweiten Agent widerlegen lassen.

### Phase 4 — Manueller Browser-Test bei UI-Änderungen

`run-web`-Skill nutzen. `apps/api` und `apps/web` brauchen dafür ein eigenes `.env` im Worktree — **`.env` gehört an die Worktree-Wurzel** (siehe Phase 2). **Nicht** das `.env` aus dem Haupt-Checkout kopieren: es enthält echte Secrets. Stattdessen die nötigen Werte neu schreiben — lokale Supabase-Adressen/-Schlüssel aus `supabase status -o json`, für `SECRET_BOX_KEYS`/`SECRET_BOX_CURRENT_KEY_VERSION`/`CONSENT_RESPONSE_HASH_PEPPER` frische Wegwerfwerte. Nach dem Test löschen. **Vor dem Start prüfen, ob Port 4200/4201 schon belegt sind** (`lsof -ti:4200/4201 -sTCP:LISTEN`).

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

## Offene Entscheidungen

`plans/README.md` listet sie am Ende. Für 016/021 wird jeweils mindestens eine Entscheidung gebraucht:

- **021 (Abomodelle)**: alles, was Geld betrifft — Zahlungsdienstleister, Preise/Deckungsrechnung, Bestandspreise, Video im kostenlosen Tarif.
- **011 (weiterhin ungeklärt)**: automatische Eskalation an die übergeordnete Ebene nach Fristablauf einer blockierten Prüfstufe — nur eine automatische *Freigabe* ist ausgeschlossen, eine Eskalation nicht.
- **010 (falls E-Mail-Versand noch nicht entschieden ist)**: eigener Anbieter oder Supabase Auth Invite.

Frag gezielt nach, statt eine Annahme zu treffen.
