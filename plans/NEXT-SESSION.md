# Prompt für die nächste Session

Alles unter der Trennlinie in eine neue Claude-Code-Session kopieren. Die Pläne selbst liegen in `plans/008`–`plans/024`, der Index in [plans/README.md](README.md).

---

Wir setzen die Planserie aus `plans/README.md` fort. Lies zuerst `plans/README.md` vollständig — dort stehen Reihenfolge, übergreifende Regeln, Rückbau-Inventar und offene Entscheidungen. Danach `AGENTS.md` und `docs/product/implementation-plan.md`.

**Du darfst und sollst Subagents und Workflows benutzen.** Die Pläne sind breit, viele Prüfungen laufen unabhängig voneinander.

## Stand

Erledigt: **008, 009, 010, 022, 023, 011, 012, 013, 014, 019, 015**. Paket 015 ist als PR #24 offen (Branch `worktree-plan-015-einwilligungsverwaltung`) — **prüfe zuerst, ob er gemergt ist** (`gh pr view 24`). Falls nicht: entweder auf den Merge warten oder für das nächste Paket von diesem Branch abzweigen, falls `packages/domain/src/consent.ts`, die neue Permission `consent.manage`, `consent_records`/`consent_requests`/`organization_consent_texts` oder die zwei neuen `policy_settings`-Felder direkt weiterverwendet werden.

**Empfehlung für das nächste Paket**: laut `plans/README.md` ist **020 (Rechtliche Pflichten und Datenschutzbetrieb)** jetzt das einzige Paket, dessen komplette Abhängigkeitskette (009, 012, 015) erledigt ist — und es wird mit jeder Sitzung dringlicher: seit 014 liegen echte Klarnamen (auch Minderjähriger) im Verzeichnis, seit 015 echte Einwilligungsnachweise samt Erziehungsberechtigten-E-Mails. Alternativ **016 (Auswertung interne Kennzahlen)** — ab 011 möglich, trifft aber sofort auf die Inhalts-Pipeline-Lücke unten (Funnel ohne echte Daten, End-to-End-Test nur per DB-Eingriff). **021 (Abomodelle)** ist ebenfalls bereit, braucht aber vorab Geschäfts-/Steuerentscheidungen vom Nutzer (Zahlungsdienstleister, Preise, Bestandspreise) — frag danach, bevor du baust.

## Was 015 mitbringt (Einwilligungsverwaltung: Registratur und digitaler Prozess)

- **`packages/domain/src/consent.ts`**: `evaluateConsent(record, at, required, policy)` prüft elf Blocker (u. a. `revoked`, `superseded`, `expired`, `guardian_missing`, `purpose_not_covered`, `platform_not_covered`); `scanTextForSensitiveData(text, linkedPersons)` erkennt regelbasiert Telefonnummer/E-Mail/IBAN/Straße+Hausnummer/Geburtsdatum sowie Namen nicht-freigegebener verknüpfter Personen. Beide verdrahtet in der um drei Blocker erweiterten `evaluateMediaGate` (`consent_scope_mismatch`, `naming_not_allowed`, `sensitive_text_data`).
- **Digitaler Weg ohne Konto**: `consent_requests` (Anfrage per E-Mail-Token, 14 Tage gültig), öffentliche Seiten `/einwilligung/[token]` (zustimmen/ablehnen) und `/einwilligung/widerruf/[token]` (dauerhafter, bei Zustimmung erzeugter Widerrufslink) — beide ohne Login, mit Rate-Limit und ohne Unterscheidbarkeit zwischen ungültig/abgelaufen/beantwortet.
- **Papierregistratur**: `POST /v1/consents` (Multipart mit Nachweis-Upload nach `raw-media`), Widerruf, Ablösung (`superseded_by`, nie ein Update). Neue Übersicht `pages/einwilligungen.vue`.
- **Einwilligungstext pro Verein editierbar** (Entscheidung 2026-08-08): `organization_consent_texts`, `text_version` = Zeilen-`id`, nie ein Update. Vorlage `DEFAULT_CONSENT_TEXT_TEMPLATE` in `apps/api/src/app.ts` — **kein Rechtstext, nur Platzhalter**, anwaltliche Prüfung vor Produktivbetrieb weiterhin Voraussetzung.
- **Aufbewahrungsfrist für Nachweise** (Entscheidung 2026-08-08): 5 Jahre ab Ende der Gültigkeit — technisch noch nicht durchgesetzt, gehört zu Paket 020.
- Neue Permission `consent.manage` (department_admin + Organisationsrollen, nicht team_manager). Widerrufskaskade per Trigger (`invalidate_approvals_for_consent_revocation`): invalidiert offene `approval_requests`, storniert `queued`-Publikationen, setzt `awaiting_approval`-Posts auf `changes_requested`.
- **Nebenbei behoben**: ein vorbestehender Bug im Vorbild-Trigger `invalidate_approvals_for_media_change` (`new.media_derivative_id` existierte auf `media_derivatives` nicht — die Spalte heißt dort `id`; der Trigger war seit der ersten Content-Pipeline-Migration nie gelaufen, weil kein Code Derivate ändert).
- **Adversarial beim eigenen Review gefunden und an drei Stellen behoben**: eine digitale Anfrage mit `recipientRole: 'self'` an eine minderjährige Person hätte eine Einwilligung ohne Erziehungsberechtigten-Bestätigung als vollständig gültig erzeugen können (`evaluateConsent`s `guardian_missing` prüft nur `signerRole === 'guardian'`, nie `is_minor`). Betrifft Registratur, digitale Anfrage **und** Ablösung — derselbe Fehler wäre an jeder der drei Stellen einzeln möglich gewesen.

**Bewusst nicht gebaut**: Übernahme eines Einwilligungsstatus aus einem Quellsystem (`origin='imported'`, kein Zielsystem mit dokumentiertem Testzugang, wie der HTTP-Adapter aus 014); die Sprachmodell-Hälfte der Textprüfung (`SafetyFlagSchema.sensitive_data` bleibt unbefüllt, bräuchte einen LLM-Aufruf im Worker, den es ohne die Inhalts-Pipeline nicht gibt); Massenerfassung mehrerer Papiererklärungen ohne Formularwechsel; ein Cron für „läuft in 30 Tagen ab"-Erinnerungen (Paket 004 weiterhin „in Arbeit"). Details in `plans/015-einwilligungsverwaltung.md`, Abschnitt „Umsetzung: Ergebnis und Abweichungen vom Plan".

## Kritischer Punkt, projektweit relevant (fünfter wiederkehrender Fund, ergänzt 011/012/013/014)

Bei jeder Stelle, die eine Rolle wie `self`/`guardian` (oder allgemein: „im eigenen Namen" vs. „stellvertretend für jemand anderen") vom Aufrufer entgegennimmt und daraus eine rechtlich bedeutsame Zustimmung ableitet: prüft der Code serverseitig, ob die **Zielperson** eine strengere Rolle erzwingt (hier: `directory_people.is_minor` erzwingt `signerRole/recipientRole === 'guardian'`) — oder wird nur die interne Konsistenz der übermittelten Rolle mit sich selbst geprüft? Bei Paket 015 betraf das drei separate Schreibpfade (Registratur, digitale Anfrage, Ablösung), nicht nur den naheliegendsten. Gehört bei jedem künftigen Paket, das Zustimmungen/Vollmachten/Vertretungsrollen einführt, zur Adversarial-Phase.

## Die Inhalts-Pipeline fehlt weiterhin

Unverändert seit 011/012/014/019: kein Code erzeugt einen `post`/eine `post_version` aus einer `submission` (Pakete 001–007 weiterhin „in Arbeit"). Betrifft jetzt auch 015: `evaluateConsent`/`evaluateMediaGate` sind als Funktionen vollständig korrekt und getestet, aber ihre Verdrahtung in `GET /v1/approval-stages/mine` (Medien-Gate-Blocker je Freigabestufe) ist erst über eine echte `post_versions`-Zeile mit Medien prüfbar — im pgTAP-Test dieser Sitzung wurde der volle Beitragspfad deshalb direkt per SQL nachgestellt, nicht über den echten Produktpfad. Wer **016** umsetzt, trifft weiterhin auf denselben fehlenden Funnel.

## Bewusst offen gelassene Punkte (unverändert seit 011/012/014, plus 015)

- `submit_requires_permission` existiert als Spalte, hat aber keine Bedeutung (011).
- Benachrichtigung der Prüfer und der tägliche „Stufen als stalled markieren"-Job sind nicht gebaut — kein Scheduler vorhanden (011). Dasselbe gilt für `recompute_directory_minor_status()` (014), `flag_channels_needing_reconnect()`/`cleanup_expired_oauth_state()` (012) und jetzt für die Ablauf-Erinnerung sowie die Aufbewahrungslöschung von Einwilligungsnachweisen (015) — alle warten auf den Hatchet-Cron aus Paket 004.
- Eine tatsächlich blockierte Freigaberoute lässt sich noch nicht auflösen — Paket 024.
- `request_approval` prüft weiterhin nicht, ob die vom Aufrufer genannten Prüfer die in der Richtlinie **konfigurierten** sind — nur Struktur, Vereinsmitgliedschaft und Minderjährigenstufe. Vor Paket 024 und vor dem ersten echten Verein mit Minderjährigen-Inhalten zu klären (`plans/024-freigaberoute-neu-aufloesen.md`, Abschnitt 2) — mit 015 (echte Einwilligungen zu echten Minderjährigen) noch einmal näher gerückt.

## Vorgehen je Arbeitspaket

Arbeite **ein Paket zu Ende**, bevor du das nächste anfängst.

### Phase 1 — Plan gegen den Code verifizieren (parallel)

Pläne zitieren konkrete `file:line`-Stellen. Vor dem Bauen mehrere Agents parallel prüfen lassen, ob diese Aussagen noch stimmen — pro Agent ein Abschnitt „Ausgangslage und Evidenz", Meldung je Behauptung: bestätigt, verschoben, oder falsch. Weicht etwas ab: zuerst den Plan aktualisieren und mir sagen, was sich geändert hat, bevor gebaut wird.

### Phase 2 — Umsetzen

`EnterWorktree` vor der ersten Codeänderung, ein Branch je Paket. **Nach `EnterWorktree` jeden absoluten Dateipfad mit dem zurückgegebenen Worktree-Präfix schreiben, nicht den Hauptcheckout-Pfad aus Gewohnheit weiterverwenden** — in dieser Sitzung landete dadurch versehentlich die gesamte Umsetzung von 015 zunächst im Hauptcheckout statt im Worktree (per `git stash`/`git stash pop` über die Worktree-Grenze korrigiert, siehe Memory). Im Zweifel nach größeren Editiersessions `git status` im Hauptcheckout prüfen. Migration → Domain → API → Oberfläche → Rückbau ist überwiegend seriell. Parallelisierbar: reine Domainfunktionen mit Tests sobald das Modell feststeht, pgTAP-Tests parallel zur Migration, Oberflächenarbeit sobald die Contracts fest sind. **Nicht** parallel: zwei Agents an derselben Migrationsdatei, an `packages/contracts/src/index.ts` oder `packages/domain/src/index.ts`.

### Phase 3 — Adversarial prüfen (parallel, unterschiedliche Blickwinkel)

1. **Mandantentrennung** — `organization_id` auf jeder neuen Tabelle, zusammengesetzte Fremdschlüssel, positive **und** negative RLS-Tests. Bei jeder neuen `security definer`-RPC: übernimmt sie sicherheitsrelevante Parameter vom Aufrufer? Bei jeder neuen RLS-Policy mit `EXISTS`/`JOIN`: unterliegt der Aufrufer dabei der Policy der abgefragten Tabelle? Bei jeder Funktion, die eine Ressource auf Scope X prüft, aber Referenzen aus einem breiteren Pool auflöst: ist der Pool selbst auf Scope X beschränkt (Fund aus 014)?
2. **Rechte** — kommt jemand an Aktionen/Daten, die der Plan ausdrücklich verwehrt? Bekommt jede Rolle, die laut Plan etwas verwalten soll, die dafür nötige Permission auch tatsächlich in **beiden** Permission-Tabellen (TS und SQL)? **Neu seit 015**: nimmt eine Stelle eine Rolle wie `self`/`guardian` vom Aufrufer entgegen — prüft sie serverseitig, ob die Zielperson/-ressource eine strengere Rolle erzwingt, an **jeder** Stelle, die eine solche Zeile anlegt oder verändert (nicht nur der naheliegendsten)?
3. **Geheimnisse** — Token, Elternkontakt, Einwilligungsnachweise, Provenienz-Felder: landen sie in einem `select` für `authenticated`, der breiter ist als nötig? Kann ein falsch zugeordnetes Feld einen sensiblen Rohwert in eine schwächer geschützte Tabelle tragen, als der eigentliche Zielwert es wäre?
4. **Verträge** — jede Systemgrenze mit Zod, Grenzfälle abgedeckt, jeder SQL-Fehlerpfad auf einen sinnvollen HTTP-Status gemappt. Kann eine kaputte Eingabe zu einem generischen 500 statt eines verständlichen 4xx führen?
5. **Rückbau** — jeder Inventar-Eintrag erledigt, kein erfundener Wert durch Null/Platzhalter ersetzt.

Ein Fund gilt erst als echt, wenn reproduzierbar. Unklare Funde von einem zweiten Agent widerlegen lassen.

### Phase 4 — Manueller Browser-Test bei UI-Änderungen

`run-web`-Skill nutzen. `apps/api` und `apps/web` brauchen dafür ein eigenes `.env` im Worktree. **Nicht** das `.env` aus dem Haupt-Checkout kopieren: es enthält echte `SECRET_BOX_KEYS` und Provider-Zugangsdaten. Stattdessen die nötigen Werte neu schreiben — lokale Supabase-Adressen/-Schlüssel aus `supabase status -o json`, für `SECRET_BOX_KEYS`/`SECRET_BOX_CURRENT_KEY_VERSION` einen frisch erzeugten Wegwerfschlüssel, für `CONSENT_RESPONSE_HASH_PEPPER` (seit 015) ebenfalls ein Wegwerfwert. Nach dem Test löschen, ebenso `apps/web/.env`. **Vor dem Start prüfen, ob Port 4200/4201 schon belegt sind** (`lsof -ti:4200/4201 -sTCP:LISTEN`) — ein stehengebliebener Prozess aus einem älteren Worktree beantwortet Anfragen sonst mit veraltetem Code, ohne dass ein Fehler auffällt; `readlink -f /proc/<pid>/cwd` verrät, aus welchem Checkout ein Prozess tatsächlich läuft.

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
- Chirurgische Änderungen: nur anfassen, was das Paket verlangt. Kein Refactoring angrenzenden Codes, kein Aufräumen fremden toten Codes — nur erwähnen.
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
- **010 (falls E-Mail-Versand noch nicht entschieden ist)**: eigener Anbieter oder Supabase Auth Invite. `EMAIL_PROVIDER=smtp` ist seit 010/015 real nutzbar (015 versendet die Einwilligungsanfrage darüber), die Beschaffungsentscheidung selbst steht weiterhin aus.

Frag gezielt nach, statt eine Annahme zu treffen.
