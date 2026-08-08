# Prompt für die nächste Session

Alles unter der Trennlinie in eine neue Claude-Code-Session kopieren. Die Pläne selbst liegen in `plans/008`–`plans/025`, der Index in [plans/README.md](README.md).

---

Wir setzen die Planserie aus `plans/README.md` fort. Lies zuerst `plans/README.md` vollständig — dort stehen Reihenfolge, übergreifende Regeln, Rückbau-Inventar und offene Entscheidungen. Danach `AGENTS.md` und `docs/product/implementation-plan.md`.

**Du darfst und sollst Subagents und Workflows benutzen.** Die Pläne sind breit, viele Prüfungen laufen unabhängig voneinander.

## Stand

Erledigt: **008, 009, 010, 022, 023, 011, 012, 013, 014, 019, 015, 025, 020**. Paket 020 ist neu und macht die Pakete 009/012/015 produktivreif: Aufbewahrungsregeln, Betroffenenrechte, Verarbeitungsdokumentation, Auftragsverarbeiter-Verwaltung, ein kryptografisch verifizierbarer Audit-Trail und ein öffentliches Impressum je Verein. **Prüfe zuerst, ob PR #26 gemergt ist** (`gh pr view 26`, Branch `worktree-plan-020-rechtliche-pflichten-und-datenschutzbetrieb`). Falls nicht: entweder auf den Merge warten oder für das nächste Paket von diesem Branch abzweigen, falls neue Contracts-Schemas oder Endpunkte aus 020 direkt weiterverwendet werden.

**Empfehlung für das nächste Paket**: **016 (Auswertung: interne Kennzahlen)** ist das einzige Paket mit komplett erledigter Abhängigkeitskette (011) und ohne offene Entscheidung, die vom Nutzer verlangt wird. Seit 025 gibt es außerdem erstmals einen (wenn auch dünnen) echten Funnel aus `post`/`post_version`/`publication`-Zeilen, den 016 auswerten kann — vor dem Bauen aber prüfen, wie viele echte Zeilen tatsächlich vorliegen (siehe Plan, Abschnitt „Ausgangslage“). Alternativ **021 (Abomodelle, Speicherkontingent)** — technisch bereit (009, 010, 011 erledigt), braucht aber vorab mehrere Geschäfts-/Steuerentscheidungen vom Nutzer (Zahlungsdienstleister, Preise/Deckungsrechnung, Bestandspreise, Video im kostenlosen Tarif). **Frag danach, bevor du 021 baust.**

## Was 020 mitbringt (Rechtliche Pflichten und Datenschutzbetrieb)

- **Sechs Aufbewahrungsregeln** (`retention_settings`, `retention_deletions`): Rohmedien, Medienderivate, Audit-Events, abgelaufene Tokens, Einwilligungsnachweise (`select_expired_consent_evidence`, neu — vorher eine Zusage ohne Job), verwaiste Auskunftsbündel (`stale_exports`, über `storage.list()`, da kein Tabelleneintrag je Export existiert). Manuell ausgelöst über `POST /v1/organizations/:id/retention/run` mit `dryRun`, protokolliert auch der Trockenlauf.
- **Betroffenenrechte** (`data_subject_requests`): Auskunft als signierter JSON-Export, Löschung mit anonymisierten Einwilligungsnachweisen statt nur entfernter FK, Berichtigung, Fristverlängerung mit `due_at`-Berechnung (`received_at + 1 Monat`).
- **Verarbeitungsdokumentation** (`processing_records`) und **Auftragsverarbeiter-Verwaltung** (`processor_agreements`, Dokument-Upload mit signierter Abruf-URL).
- **Manipulationssicherer Audit-Trail**: `audit_events` trägt jetzt `chain_seq`/`prev_hash`/`hash` (Hash-Kette per Trigger), `audit_chain_signatures` speichert eine externe HMAC-Signatur (`packages/secrets` `createChainSigner`, HKDF-abgeleiteter Schlüssel getrennt vom AES-Schlüssel der `SecretBox`). `GET .../audit-chain/verify` prüft die Signatur jetzt tatsächlich kryptografisch (`signatureValid`), nicht nur `signed_at`.
- **Öffentliches Impressum je Verein** (`GET /v1/organizations/:id/imprint`, unauthentifiziert, serverseitig gerendert, verlinkbar aus der Social-Media-Bio) sowie produktweite `impressum`/`datenschutz`-Seiten mit ausdrücklich markierten Platzhaltern.
- **Kritischster Fund der adversarialen Prüfung, projektweit relevant**: `media_assets.object_path` hat kein CHECK gegen `organization_id`. Ein Mitglied im eigenen Verein A konnte per `INSERT` eine Zeile mit `object_path` im Ordner eines fremden Vereins B anlegen; der service-role-Retention-Lauf hätte ein echtes Storage-Objekt von B gelöscht. Behoben durch einen Pfadpräfix-Filter in `select_expired_raw_media`/`select_expired_media_derivatives`. **Diese Lücke im Schema selbst bleibt bewusst offen** (gehört zur Content-Pipeline 001–007) — jeder künftige Code, der `media_assets`/`media_derivatives` mit Service-Role liest und dabei dem `object_path` vertraut, muss densselben Filter mitbringen.
- Rund zehn weitere Funde (Audit-Signatur war wirkungslos, Erase-Endpunkt hinterließ Identitätsdaten, mehrere unbehandelte DB-CHECK-Verstöße als 500er, `x-correlation-id` als vom Aufrufer kontrollierbarer Header, Storage-Policy-Regression bei einer echten Rechtelücke) — alle mit Regressionstests belegt. Vollständige Liste: `plans/020-rechtliche-pflichten-und-datenschutzbetrieb.md`, Abschnitt „Umsetzung: Ergebnis und Abweichungen vom Plan“.
- **Bewusst nicht gebaut**: vollständige, irreversible Vereinskonto-Löschung (verdient eine eigene Umsetzung); Hatchet-Cron für Retention-Lauf und Audit-Signatur (Paket 004 weiterhin „in Arbeit“, beide bis dahin manuell auszulösen); automatisierter Netzwerktest für „keine Drittanbieter-Aufrufe“ (keine Browser-Test-Infrastruktur im Repository, manuell geprüft).

## Kritischer Punkt, projektweit relevant (aus 025, weiterhin gültig)

**Ein an anderer Stelle gelesener, aber nie geschriebener Wert legt die erwartete Form fest — nicht die „korrekte" Verschachtelung des Quelltyps.** `effective_config_snapshot` wurde bis 025 von niemandem beschrieben, aber von zwei Stellen (`schedule_publication`, `available-channels`) bereits mit einer bestimmten (flachen) Formannahme gelesen. Bei jeder Spalte, die von A geschrieben und von B (an anderer Stelle, früher gebaut) gelesen wird, ohne dass es bisher einen Schreibzugriff gab: die tatsächliche Lesestelle prüfen, nicht nur den Typ des Schreibers. Für 016 potenziell relevant: `workflow_runs`, `post_status_events` (neu) und jede Aggregatspalte, die 016 selbst zuerst beschreibt.

## Bewusst offen gelassene Punkte (unverändert seit 011/012/014/015/025, plus 020)

- `submit_requires_permission` existiert als Spalte, hat aber keine Bedeutung (011).
- Benachrichtigung der Prüfer, der tägliche „Stufen als stalled markieren"-Job, `recompute_directory_minor_status()` (014), `flag_channels_needing_reconnect()`/`cleanup_expired_oauth_state()` (012), Retention-Lauf und Audit-Signatur (020) — alle warten weiterhin auf den Hatchet-Cron aus Paket 004, der weiterhin nicht produktiv läuft.
- Eine tatsächlich blockierte Freigaberoute lässt sich noch nicht auflösen — Paket 024 (Entwurf, noch nicht bestätigt).
- `request_approval` prüft weiterhin nicht, ob die vom Aufrufer genannten Prüfer die in der Richtlinie **konfigurierten** sind (`plans/024-freigaberoute-neu-aufloesen.md`, Abschnitt 2).
- `evaluateMediaGate`/`computeMediaGateBlockersForPostVersion` bleiben rein informativ für Reviewer, nicht als echter Blocker in `decide_approval_stage`/`schedule_publication` verdrahtet.
- Der UI-Trigger für `request_approval` fehlt in `erstellen.vue` — `freigaben.vue` bleibt deshalb leer, bis dieser Trigger gebaut wird.
- Kein Hatchet-Cron, der eine künftig geplante Veröffentlichung automatisch ausführt — `POST /v1/publications/:id/execute` bleibt ein expliziter, manueller Trigger.
- Vollständige, irreversible Vereinskonto-Löschung fehlt (020).

## Vorgehen je Arbeitspaket

Arbeite **ein Paket zu Ende**, bevor du das nächste anfängst.

### Phase 1 — Plan gegen den Code verifizieren (parallel)

Pläne zitieren konkrete `file:line`-Stellen. Vor dem Bauen mehrere Agents parallel prüfen lassen, ob diese Aussagen noch stimmen — pro Agent ein Abschnitt „Ausgangslage und Evidenz", Meldung je Behauptung: bestätigt, verschoben, oder falsch. Weicht etwas ab: zuerst den Plan aktualisieren und mir sagen, was sich geändert hat, bevor gebaut wird. **Bei 016 besonders wichtig**: der Plan geht von einem noch dünnen oder leeren Funnel aus (025 ist neu) — vor dem Bauen prüfen, wie viele echte `post`/`post_version`/`publication`-Zeilen tatsächlich vorliegen.

### Phase 2 — Umsetzen

`EnterWorktree` vor der ersten Codeänderung, ein Branch je Paket. **Nach `EnterWorktree` jeden absoluten Dateipfad mit dem zurückgegebenen Worktree-Präfix schreiben, nicht den Hauptcheckout-Pfad aus Gewohnheit weiterverwenden** — das ist in dieser Serie bereits zweimal versehentlich passiert (015, 020). Migration → Domain → API → Oberfläche → Rückbau ist überwiegend seriell. Parallelisierbar: reine Domainfunktionen mit Tests sobald das Modell feststeht, pgTAP-Tests parallel zur Migration, Oberflächenarbeit sobald die Contracts fest sind. **Nicht** parallel: zwei Agents an derselben Migrationsdatei, an `packages/contracts/src/index.ts` oder `packages/domain/src/index.ts`.

**Env-Dateien für den manuellen Browser-Test liegen an der Worktree-WURZEL, nicht in `apps/api/`**: `apps/api/package.json`s `dev`-Skript lädt `../../.env` relativ zum `apps/api`-Arbeitsverzeichnis — das ist die Worktree-Wurzel (zwei Ebenen höher), nicht `apps/api/.env`.

### Phase 3 — Adversarial prüfen (parallel, unterschiedliche Blickwinkel)

1. **Mandantentrennung** — `organization_id` auf jeder neuen Tabelle, zusammengesetzte Fremdschlüssel, positive **und** negative RLS-Tests. Bei jeder neuen `security definer`-RPC: übernimmt sie sicherheitsrelevante Parameter vom Aufrufer? Bei jeder neuen RLS-Policy mit `EXISTS`/`JOIN`: unterliegt der Aufrufer dabei der Policy der abgefragten Tabelle? Bei jeder service-role-Löschung anhand einer Pfad-/Referenzspalte ohne CHECK: kann ein Aufrufer im eigenen Verein diese Spalte auf ein fremdes Ziel zeigen lassen (siehe 020s Cross-Tenant-Fund)?
2. **Rechte** — kommt jemand an Aktionen/Daten, die der Plan ausdrücklich verwehrt? Bekommt jede Rolle, die laut Plan etwas verwalten soll, die dafür nötige Permission auch tatsächlich in **beiden** Permission-Tabellen (TS und SQL)?
3. **Geheimnisse** — Token, Elternkontakt, Einwilligungsnachweise, Provenienz-Felder: landen sie in einem `select` für `authenticated`, der breiter ist als nötig?
4. **Verträge** — jede Systemgrenze mit Zod, Grenzfälle abgedeckt, jeder SQL-Fehlerpfad auf einen sinnvollen HTTP-Status gemappt (nicht nur ein generischer 500 bei einem CHECK-Verstoß, siehe 020).
5. **Rückbau** — jeder Inventar-Eintrag erledigt, kein erfundener Wert durch Null/Platzhalter ersetzt. Bei jeder in der Oberfläche behaupteten Frist/Zusage: existiert dafür tatsächlich Code, der sie einhält (dieselbe Fehlerklasse wie ursprünglich bei 020s Auslöser, seitdem bereits einmal in 020 selbst wiederholt bei `consent_evidence_years`)?
6. **Gelesen-vor-geschrieben** — bei jeder Spalte, die von einer neuen Stelle erstmals BESCHRIEBEN wird, aber von einer älteren Stelle bereits GELESEN wird: die tatsächliche Lesestelle prüfen, nicht nur den Typ nachbilden (siehe „Kritischer Punkt" oben).

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

`plans/README.md` listet sie am Ende. Für 021 wird mindestens eine Entscheidung gebraucht, für 016 keine:

- **021 (Abomodelle)**: alles, was Geld betrifft — Zahlungsdienstleister, Preise/Deckungsrechnung, Bestandspreise, Video im kostenlosen Tarif.
- **011 (weiterhin ungeklärt)**: automatische Eskalation an die übergeordnete Ebene nach Fristablauf einer blockierten Prüfstufe — nur eine automatische *Freigabe* ist ausgeschlossen, eine Eskalation nicht.
- **010 (falls E-Mail-Versand noch nicht entschieden ist)**: eigener Anbieter oder Supabase Auth Invite.

Frag gezielt nach, statt eine Annahme zu treffen.
