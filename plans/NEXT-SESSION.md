# Prompt für die nächste Session

Alles unter der Trennlinie in eine neue Claude-Code-Session kopieren. Die Pläne selbst liegen in `plans/008`–`plans/024`, der Index in [plans/README.md](README.md).

---

Wir setzen die Planserie aus `plans/README.md` fort. Lies zuerst `plans/README.md` vollständig — dort stehen Reihenfolge, übergreifende Regeln, Rückbau-Inventar und offene Entscheidungen. Danach `AGENTS.md` und `docs/product/implementation-plan.md`.

**Du darfst und sollst Subagents und Workflows benutzen.** Die Pläne sind breit, viele Prüfungen laufen unabhängig voneinander.

## Stand

Erledigt: **008, 009, 010, 022, 023, 011, 012, 013, 014**. Paket 014 ist als PR offen (Branch `worktree-plan-014-integrationsrahmen-und-mitgliederverzeichnis`) — **prüfe zuerst, ob er gemergt ist** (`gh pr list`). Falls nicht: entweder auf den Merge warten oder für das nächste Paket von diesem Branch statt von `main` abzweigen, falls `packages/integrations`, `packages/member-directory`, `directory_people` oder die neuen Permissions `directory.read`/`integration.manage` direkt weiterverwendet werden.

**Empfehlung für das nächste Paket**: laut `plans/README.md` als nächstes entweder **019** (Mannschaften/Spielpläne/Veranstaltungen — erster echter Nutzen des Integrationsrahmens aus 014, hängt nur an 014) oder **015** (Einwilligungsverwaltung — hängt an 002 und 014, beide erledigt bzw. `directory_people` steht bereit). Vor 015 wird deine Entscheidung zu „Einwilligungstext je Verein oder global“ gebraucht. Vor 019 wird deine Entscheidung zu „Verlegte Spiele“ gebraucht. 016 (Auswertung) und 021 (Abomodelle) sind seit 011 ebenfalls jederzeit möglich — 016 trifft aber weiterhin sofort auf die Inhalts-Pipeline-Lücke unten.

## Was 013 mitbringt (Marke, Branding-Assets, Schriften)

- `brand_assets`: eine Tabelle für alle Markenmedien (Logovarianten, Wortmarke, Wasserzeichen, eigene Schriftdateien), mit Besitzebene (`organization_id` + optional `department_id`/`team_id`), Status (`processing`/`ready`/`rejected`/`replaced`) und — bei Schriften — Pflichtfeldern für die Lizenzbestätigung, per CHECK-Constraint vor `status = 'ready'` erzwungen.
- `resolveBrand()`/`isBrandAssetSelectable()` (`packages/domain/src/brand.ts`) plus SQL-Gegenstück `authz.brand_asset_is_selectable()`: Vererbungsmuster „Ersetzung, nicht Verschärfung“ — anders als `resolveEffectiveConfig` aus 011 dürfen Abteilung/Team hier Farben, Schrift und Logo komplett ersetzen, sofern nicht durch `lockedFields` gesperrt.
- Neue Permission `brand.manage` (TS und SQL). Font-Pipeline (`apps/api/src/brandFont.ts`): Uploads (TTF/OTF/WOFF2) werden serverseitig zu WOFF2 konvertiert, ausgeliefert wird nur das Derivat; kuratierte Schriften werden seit 013 selbst gehostet, nicht mehr von `fonts.googleapis.com` geladen.
- Adversarial gefunden und behoben: `department_brand_profiles.logo_asset_id` konnte ohne `authz.brand_asset_is_selectable()` in der `WITH CHECK`-Klausel ein fremdes Abteilungs-Asset referenzieren — API-seitige Vorabprüfung allein reichte nicht (dieselbe Fehlerklasse wie der 012-Fund, hier bei einer normalen Policy statt einer RPC).

**Bekannter, app-weiter Befund (weiterhin nicht behoben, außerhalb jedes Paket-Scopes)**: `useSession()`/`useScope()` sind serverseitig grundsätzlich leer, jede authentifizierte Seite zeigt einen Vue-Hydration-Mismatch in der Konsole (funktional harmlos, Endergebnis nach Hydration korrekt). Eine echte Behebung braucht eine serverseitige Sitzungsauflösung und ist ein eigenes, app-weites Vorhaben — nicht als neuen, paketspezifischen Bug missverstehen, falls er wieder auffällt.

## Was 014 mitbringt (Integrationsrahmen und Mitgliederverzeichnis)

- **`packages/integrations`**: `planSync()` als bereichsunabhängiger Abgleichmechanismus (neu/geändert/stillgelegt/Konflikt, Verlustschwelle, „lokale Änderung gewinnt“, nie automatische Zuordnung bei unscharfem Treffer) plus Datei- (CSV/XLSX, über `exceljs` — **nicht** `xlsx`/SheetJS, das zwei unbehobene High-Severity-CVEs hat) und iCal-Transport. **Kein HTTP-Adapter** — kein Zielsystem mit dokumentiertem Testzugang, bewusst verschoben. Ein neuer, optionaler `MatchStrategy.isRetirable(local)`-Hook stellt sicher, dass von Hand gepflegte Datensätze (`source_id = null`) zwar Abgleichskandidaten sind (Duplikatvermeidung), aber nie durch einen fremden Sync-Lauf als „ausgetreten“ gelten oder die Verlustschwelle verfälschen — **dieser Fund kam ausschließlich aus dem manuellen Browser-Test**, kein gemockter Test mit leerem `existing`-Array hätte ihn gezeigt.
- **`packages/member-directory`**: erster Bereich auf dem Rahmen. `directory_people` mit den in Plan 014 abschließend aufgezählten Feldern (Vorname, Nachname, Geburtsjahr — nie volles Geburtsdatum —, Abteilung/Mannschaft, Status/Austrittsdatum, Elternkontakt). `deriveIsMinor()`: das ganze Kalenderjahr des 18. Geburtstags gilt als minderjährig.
- Neue Permissions `directory.read` (department_admin/team_manager plus Organisationsrollen) und `integration.manage` (nur department_admin plus Organisationsrollen — `integration_sources` kennt keine Team-Ebene), dupliziert in TS und SQL.
- Elternkontakt ist spaltenweise gesperrt, nur über `GET /v1/directory-people/:id/guardian-contact` mit `department.manage` lesbar, jeder Zugriff wird auditiert.
- Neue Seiten `/integrationen`, `/verzeichnis`, und eine erste eigene Profilseite `/profil` (Anzeigename ändern, Vereinsmitgliedschaften nur lesend) — vorher gab es dafür keinen Endpunkt und keine Seite.
- **Adversarial gefunden und behoben** (vier parallele Prüfungen plus manueller Browser-Test): eine abteilungsgebundene Quelle konnte über eine Datei-Spalte in eine fremde Abteilung schreiben; ein nicht auflösbarer Struktur-Name landete roh in einer nur `integration.manage`-geschützten, unauditierten Konfliktzeile; mehrdeutige Fuzzy-Treffer wurden fälschlich als „ausgetreten“ gezählt. Details in Plan 014, Abschnitt „Adversariale Prüfung: Funde und Korrekturen“.
- **Bewusst nicht gebaut**: `take_incoming`/`keep_current` bei der Konfliktauflösung verändert `directory_people` nicht wirklich, nur `ignore_permanently` hat echte Wirkung; kein Foto-Upload für die eigene Profilseite (kein Bucket/keine Pipeline vorgesehen); die automatische Prüfmarkierung veröffentlichter Beiträge bei nachträglich erkannter Minderjährigkeit fehlt weiterhin (braucht eine Personen-Medien-Verknüpfung, die es ohne die Inhalts-Pipeline nicht gibt).

## Kritischer Punkt, projektweit relevant (ergänzt die Funde aus 011/012/013)

Bei jeder neuen `security definer`-RPC mit `grant … to authenticated` weiterhin fragen: übernimmt sie sicherheitsrelevante Werte vom Aufrufer statt sie selbst herzuleiten? Bei jeder neuen RLS-Policy mit `EXISTS`/`JOIN` gegen eine andere Tabelle: prüft der vorgesehene Aufrufer laut deren **eigener** Policy überhaupt diese Tabelle? Bei jeder FK-Spalte, die wahlweise auf eine vereinsweite oder eine untergeordnete Zeile zeigen darf: hat die `WITH CHECK`-Klausel eine eigene Selectability-Prüfung per `security definer`-Funktion? Paket 014 fügt einen vierten wiederkehrenden Fund hinzu:

**Eine scope-begrenzende Ressource (hier: eine abteilungsgebundene Integrationsquelle) muss ihre eigenen Nachschlage-Abfragen (hier: Abteilungs-/Mannschaftsnamen) ebenfalls auf ihren Scope beschränken.** Es reicht nicht, den Schreibzugriff auf der obersten Ebene zu prüfen (`integration.manage` auf die Quelle), wenn die Business-Logik darunter Daten aus einem breiteren Pool lädt (alle Abteilungen des Vereins) und daraus unterschiedslos in JEDE davon schreiben kann. Bei jeder neuen Funktion, die eine Berechtigung auf Ebene X prüft, aber danach Referenzen/Namen auf Ebene X-oder-tiefer aus einem gemeinsamen Pool auflöst: prüfen, ob der Pool selbst auf den geprüften Scope eingeschränkt ist.

## Die Inhalts-Pipeline fehlt weiterhin

Unverändert seit 011/012: kein Code erzeugt einen `post`/eine `post_version` aus einer `submission` (Pakete 001–007 weiterhin „in Arbeit“). Betrifft jetzt auch 014: die geplante „veröffentlichte Beiträge zur Prüfung markieren, wenn eine Person nachträglich als minderjährig erkannt wird“ ist ohne eine Personen-Medien-Verknüpfung nicht baubar und bleibt offen. Wer **016** umsetzt, trifft weiterhin auf denselben fehlenden Funnel.

## Offener sicherheitsrelevanter Punkt aus 011 (weiterhin ungeklärt)

`request_approval` prüft nicht, ob die vom Aufrufer genannten Prüfer die in der Richtlinie **konfigurierten** sind — nur Struktur, Vereinsmitgliedschaft und das Vorhandensein der Minderjährigenstufe. `plans/024-freigaberoute-neu-aufloesen.md`, Abschnitt 2, stellt die beiden Auswege gegenüber. **Vor 024 zu klären, und vor dem ersten echten Verein mit Minderjährigen-Inhalten** — was mit 014 (echte Klarnamen minderjähriger Personen im Verzeichnis) näher gerückt ist.

## Bewusst offen gelassene Punkte (unverändert seit 011/012, plus 014)

- `submit_requires_permission` existiert als Spalte, hat aber keine Bedeutung (011).
- Benachrichtigung der Prüfer und der tägliche „Stufen als stalled markieren“-Job sind nicht gebaut — kein Scheduler vorhanden (011). Dasselbe gilt für `recompute_directory_minor_status()` (014) und `flag_channels_needing_reconnect()`/`cleanup_expired_oauth_state()` (012): fertige, nur für `service_role` aufrufbare Funktionen, die auf den Hatchet-Cron aus Paket 004 warten.
- Eine tatsächlich blockierte Freigaberoute lässt sich noch nicht auflösen — Paket 024.
- `sync-integration-source` ist in `WorkflowNameSchema` reserviert, aber nicht verdrahtet — Paket 014 führt einen Sync-Lauf synchron in der API-Anfrage aus, solange Paket 004 „in Arbeit“ ist.

## Vorgehen je Arbeitspaket

Arbeite **ein Paket zu Ende**, bevor du das nächste anfängst.

### Phase 1 — Plan gegen den Code verifizieren (parallel)

Pläne zitieren konkrete `file:line`-Stellen. Vor dem Bauen mehrere Agents parallel prüfen lassen, ob diese Aussagen noch stimmen — pro Agent ein Abschnitt „Ausgangslage und Evidenz“, Meldung je Behauptung: bestätigt, verschoben, oder falsch. Weicht etwas ab: zuerst den Plan aktualisieren und mir sagen, was sich geändert hat, bevor gebaut wird.

### Phase 2 — Umsetzen

`EnterWorktree` vor der ersten Codeänderung, ein Branch je Paket. Migration → Domain → API → Oberfläche → Rückbau ist überwiegend seriell. Parallelisierbar: reine Domainfunktionen mit Tests sobald das Modell feststeht, pgTAP-Tests parallel zur Migration, Oberflächenarbeit sobald die Contracts fest sind. **Nicht** parallel: zwei Agents an derselben Migrationsdatei, an `packages/contracts/src/index.ts` oder `packages/domain/src/index.ts`.

### Phase 3 — Adversarial prüfen (parallel, unterschiedliche Blickwinkel)

1. **Mandantentrennung** — `organization_id` auf jeder neuen Tabelle, zusammengesetzte Fremdschlüssel, positive **und** negative RLS-Tests. Bei jeder neuen `security definer`-RPC: übernimmt sie sicherheitsrelevante Parameter vom Aufrufer? Bei jeder neuen RLS-Policy mit `EXISTS`/`JOIN`: unterliegt der Aufrufer dabei der Policy der abgefragten Tabelle? Bei jeder Funktion, die eine Ressource auf Scope X prüft, aber Referenzen aus einem breiteren Pool auflöst: ist der Pool selbst auf Scope X beschränkt (siehe Fund aus 014 oben)?
2. **Rechte** — kommt jemand an Aktionen/Daten, die der Plan ausdrücklich verwehrt? Bekommt jede Rolle, die laut Plan etwas verwalten soll, die dafür nötige Permission auch tatsächlich in **beiden** Permission-Tabellen (TS und SQL)? Sind zwei Permissions, die heute zufällig deckungsgleich sind (z. B. `integration.manage`/`department.manage` in 014), an der Stelle, wo es wirklich auf den Unterschied ankommt, auch **explizit** geprüft?
3. **Geheimnisse** — Token, Elternkontakt, Einwilligung, Provenienz-Felder: landen sie in einem `select` für `authenticated`, der breiter ist als nötig? Kann ein falsch zugeordnetes Feld (Import-Mapping, freie Texteingabe) einen sensiblen Rohwert in eine schwächer geschützte Tabelle tragen, als der eigentliche Zielwert es wäre (siehe Fund aus 014 zu `integration_sync_conflicts.incoming_value`)?
4. **Verträge** — jede Systemgrenze mit Zod, Grenzfälle abgedeckt, jeder SQL-Fehlerpfad auf einen sinnvollen HTTP-Status gemappt. Kann eine kaputte Eingabedatei/ein kaputter Feed zu einem generischen 500 statt eines verständlichen 4xx führen?
5. **Rückbau** — jeder Inventar-Eintrag erledigt, kein erfundener Wert durch Null/Platzhalter ersetzt.

Ein Fund gilt erst als echt, wenn reproduzierbar. Unklare Funde von einem zweiten Agent widerlegen lassen.

### Phase 4 — Manueller Browser-Test bei UI-Änderungen

`run-web`-Skill nutzen. Nicht nur auf grüne Tests verlassen — Paket 014 fand einen echten Fund (siehe oben) ausschließlich dadurch, dass eine bereits gefüllte Datenbank mit einer von Hand angelegten Person gegen einen echten Sync-Lauf lief; kein gemockter API-Test mit leerem `existing`-Array hätte das gezeigt. `apps/api` braucht dafür ein eigenes `.env` im Worktree. **Nicht** das `.env` aus dem Haupt-Checkout kopieren: es enthält echte `SECRET_BOX_KEYS` und Provider-Zugangsdaten, die dann in jedem zusätzlichen Worktree liegen. Stattdessen die nötigen Werte neu schreiben — die lokalen Supabase-Adressen und -Schlüssel aus `supabase status`, für `SECRET_BOX_KEYS`/`SECRET_BOX_CURRENT_KEY_VERSION` einen frisch erzeugten Wegwerfschlüssel. Nach dem Test löschen, ebenso `apps/web/.env`.

## Definition of Done je Paket

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Bei Datenbankänderungen zusätzlich:

```bash
pnpm db:start && pnpm db:reset && pnpm db:test
```

Alles muss grün sein. Danach Statuswert in `plans/README.md` auf `erledigt` setzen, Rückbau-Inventar abhaken, abhängige Pläne (die auf dieses Paket verweisen) mit dem tatsächlichen Ergebnis aktualisieren — siehe wie 011 dies für 012/016 nachgezogen hat, 012 für 006/009/014/023, und 014 jetzt für 015/019 (Hinweis-Absatz in `plans/README.md`).

## Verbindliche Regeln

- `AGENTS.md` gilt: jede mandantenbezogene Tabelle mit `organization_id`, zusammengesetzte Fremdschlüssel, RLS mit positiven und negativen Tests, Service Role nur in API und Workern, Provider nur hinter Interfaces, Zod an jeder Systemgrenze.
- Übergreifende Regeln in `plans/README.md` sind bindend.
- **Kein erfundener Wert wird durch eine Null oder einen grauen Balken ersetzt.**
- Chirurgische Änderungen: nur anfassen, was das Paket verlangt. Kein Refactoring angrenzenden Codes, kein Aufräumen fremden toten Codes — nur erwähnen.
- Minimaler Code. Keine Abstraktion für einen einzigen Aufrufer, keine ungefragte Konfigurierbarkeit.
- Neue Laufzeitabhängigkeiten vor dem Festlegen kurz auf bekannte CVEs prüfen (`pnpm audit`) — Paket 014 musste `xlsx`/SheetJS (zwei unbehobene High-Severity-CVEs, npm bekommt keine gepatchten Versionen mehr) durch `exceljs` ersetzen, nachdem ein Hintergrund-Agent es zunächst gewählt hatte.
- Commits und PR-Beschreibungen ohne jeden Hinweis auf Claude, Anthropic oder Claude Code.
- Deutsch in Produkttexten, Plänen und Commit-Messages. Code, Bezeichner und SQL bleiben englisch.
- Bei echten Mehrdeutigkeiten fragen, nicht raten. Bei eindeutigen Aufgaben direkt umsetzen.
- Design-Entscheidungen, die sich beim Bauen als nötig erweisen, im Plan selbst dokumentieren statt still anzuwenden.
- Squash-Merges ändern die Commit-SHA auf `main`. Vor dem Erstellen einer PR für ein neues Paket prüfen, ob die eigene Branch-Historie noch auf dem echten `main` aufsetzt (`git log --oneline origin/main -3` gegen die eigene Historie) — sonst zeigt die PR den Diff des bereits gemergten Vorgänger-Pakets erneut. Im Zweifel `git rebase --onto origin/main <alter-Basis-Commit> HEAD`, bevor gepusht/die PR erstellt wird.

## Offene Entscheidungen

`plans/README.md` listet sie am Ende. Für 016/019/021 wird jeweils mindestens eine Entscheidung gebraucht:

- **019 (Mannschaften/Spielpläne)**: „Verlegte Spiele“ — wird ein bereits veröffentlichter Ankündigungsbeitrag automatisch als überholt markiert?
- **015 (Einwilligungsverwaltung)**: Einwilligungstext je Verein oder global (beeinflusst, ob `text_version` global oder pro Verein geführt wird), Aufbewahrungsfrist für Einwilligungsnachweise (Vorschlag: fünf Jahre ab Ende der Gültigkeit, gehört eigentlich zu 020).
- **021 (Abomodelle)**: alles, was Geld betrifft — Zahlungsdienstleister, Preise/Deckungsrechnung, Bestandspreise, Video im kostenlosen Tarif.
- **010 (falls E-Mail-Versand noch nicht entschieden ist)**: eigener Anbieter oder Supabase Auth Invite.

Frag gezielt nach, statt eine Annahme zu treffen.
