# 053 – PlayerBoard: Veo-Anbindung, Spielstatistiken und öffentliche Veo-Werte

## Ergebnis

Eine Mannschaft verbindet ihren Veo-Account einmalig. Danach holt Vereinsfunk regelmäßig die Spiele samt Mannschafts- und Spielerstatistiken (Distanz, Sprints, Geschwindigkeit, hochintensive Läufe, Spielminuten, Torschüsse, Tore, Torbeteiligungen). Spieler sehen ihre eigenen Werte und die ihrer Mitspieler; wie weit die Werte über die Mannschaft hinaus sichtbar sind, legt die Hierarchie über `stats_visibility` fest (Paket 052). Die Spiele landen im **Spielplan des Rahmens** (`fixtures`) statt in einer eigenen Spieltabelle, und zwar mit Ergebnis. Ein über iCal oder von Hand gepflegtes Spiel wird mit dem Veo-Spiel zusammengeführt und nicht verdoppelt. Spielerwerte werden über die Rückennummer dem Kader zugeordnet und sind pro Spiel korrigierbar. Eine Mannschaft kann ausgewählte Veo-Werte ohne Namen öffentlich zeigen, wenn Verein und Abteilung das erlauben.

Fachlich ist das der Umfang von playerboard 003 (Veo-Mannschaftsstatistiken), 004 (Spielerstatistiken) und 005 (öffentlicher Veo-Tab), neu gebaut auf den Strukturen von Vereinsfunk. Wie in 052 gibt es keinen Datenumzug.

## Ausgangslage und Evidenz

Geplant auf `e3fb52d` am 2026-10-05, gegen playerboard `66f3879`.

- **Voraussetzung**: 052 (Kader `playerboard_players`, Rechte `training.*`/`playerboard.manage`, `playerboard_settings`).
- playerboard ruft Veos **interne, nicht dokumentierte** Web-API auf (`app/server/utils/veo/`): `login.ts` erzeugt mit E-Mail und Passwort einmalig ein `auth.veo.co`-Session-Cookie, `auth.ts` tauscht es per OIDC gegen ein etwa einstündiges Token, `client.ts` listet Vereine, Mannschaften und Spiele, `mapStats.ts`/`mapPlayerStats.ts` übersetzen `POST app.veo.co/api/app/analysis/stats/`.
- playerboard speichert das Session-Cookie **im Klartext** in `veo_sync_credentials.session_cookie` und synchronisiert innerhalb eines Nitro-Requests (`POST /api/veo/sync`).
- Vereinsfunk hat dafür bereits:
  - `integration_sources` (Paket 014) mit Transport `http`, `credentials_secret_id` (bisher „unbenutzt bis HTTP-Adapter“), `sync_cron`, Laufhistorie `integration_sync_runs` und den serialisierten, idempotenten Lauf-Slot aus Paket 026
  - `packages/secrets` (SecretBox) für verschlüsselte Zugangsdaten
  - `fixtures` mit `source_id`/`external_id`, Ergebnis (`home_score`/`away_score`, Status `played`) und die Zuordnungsheuristik `packages/club-schedule/src/fixtureMatch.ts`
  - Hatchet-Worker mit ID-only-Nachrichten (Paket 004/038)

## Fachliches Modell

### Veo ist eine Integrationsquelle

Eine Veo-Verbindung ist eine `integration_sources`-Zeile mit `provider_key = 'veo'`, `transport = 'http'`, `enabled_domains = '{fixtures}'` und Abteilungsbezug. Damit erbt sie ohne neuen Code: Laufhistorie, Abbrechen hängender Läufe, Rechte (`integration.manage`), Cron und die Anzeige unter `/integrationen`.

Was der Integrationsrahmen **nicht** abdeckt, ergänzt eine PlayerBoard-Tabelle: welche Veo-Mannschaft zu welcher Vereinsfunk-Mannschaft gehört und die Statistikwerte selbst. Der Rahmen synchronisiert `fixtures`; die Statistiken schreibt ein PlayerBoard-Schritt im selben Lauf.

### Spiele werden mit dem Spielplan zusammengeführt

Pro Veo-Spiel:

1. `fixtures` mit `source_id = Veo-Quelle` und `external_id = Veo-Spiel-ID` vorhanden → aktualisieren.
2. Wenn kein Fixture mit dieser Veo-ID existiert, führt der Worker einen expliziten Veo-Fallback-Abgleich aus (eigener Worker-Schritt oder Erweiterung von `planSync`/`fixtureMatch`): Er bestimmt Kandidaten derselben Mannschaft anhand von Anstoßdatum, Gegner und Heim/Auswärts-Status. Nur bei genau einem Treffer werden **Ergebnis und Statistiken daran gehängt**, ohne Stammdaten zu überschreiben, die eine andere Quelle verwaltet. Bei mehreren Treffern wird ein `integration_sync_conflicts`-Eintrag angelegt; bei keinem Treffer greift Schritt 3.
3. Sonst ein neues `fixtures`-Spiel mit Status `played` anlegen.

Mehrdeutige Treffer werden zu einem `integration_sync_conflicts`-Eintrag statt zu einer Vermutung — dasselbe Verhalten wie beim iCal-Import.

### Spielerzuordnung über die Rückennummer

Wie in playerboard 004: Veo liefert meist nur Rückennummern. Automatische Zuordnung gegen `playerboard_players.jersey_number` derselben Mannschaft; Trainer korrigieren pro Spiel (`matched_manually = true` überlebt jeden weiteren Sync). Ein Kader-Eintrag hat pro Spiel höchstens eine Rückennummer.

### Alles oder nichts je Spiel

Schlägt der Abruf der Spielerwerte fehl, wird das Spiel in diesem Lauf gar nicht geschrieben, auch nicht die Mannschaftswerte (playerboard 004, Klärung vom 2026-09-23). Halbe Spiele in der Statistik sind schlechter als ein Spiel, das im nächsten Lauf kommt.

### Öffentliche Veo-Werte

Teil der öffentlichen Mannschaftsseite aus 052: Der Trainer schaltet `playerboard_settings.public_veo_stats_enabled`, wirksam nur bei `public_sharing_allowed` entlang des ganzen Pfads. Öffentlich sind Spiele mit Gegner, Datum und Ergebnis, die Mannschaftswerte und die Spielerwerte. Spieler erscheinen nur über `playerboard_public_label` als Rückennummer und Initialen („#7 M. K.“), nie mit Klarnamen. Nicht zugeordnete Rückennummern erscheinen als „#7“. Ausgeliefert über `public.playerboard_public_veo_stats(org_slug, public_slug, from, to)` (`security definer`, nur `service_role`) als Reiter „Veo“ auf `/mannschaft/[orgSlug]/[teamSlug]`.

## Datenmodell

Migration `<datum>_playerboard_veo.sql`:

```sql
create table public.playerboard_veo_links (
  team_id uuid primary key,
  organization_id uuid not null, department_id uuid not null,
  integration_source_id uuid not null,
  veo_club_slug text not null, veo_team_slug text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, department_id, team_id)
    references public.teams(organization_id, department_id, id) on delete cascade,
  foreign key (organization_id, integration_source_id)
    references public.integration_sources(organization_id, id) on delete cascade
);

create table public.playerboard_veo_match_stats (
  organization_id uuid not null, fixture_id uuid not null,
  team_association text not null check (team_association in ('own', 'opponent')),
  stat_type text not null, category text not null,
  value integer not null, period_values jsonb not null,
  primary key (fixture_id, team_association, stat_type),
  foreign key (organization_id, fixture_id)
    references public.fixtures(organization_id, id) on delete cascade
);

create table public.playerboard_veo_player_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null, fixture_id uuid not null,
  veo_jersey_number integer not null,
  player_id uuid,                                       -- null = nicht zugeordnet
  matched_manually boolean not null default false,
  unique (organization_id, id),
  unique (organization_id, fixture_id, veo_jersey_number),
  unique (organization_id, fixture_id, player_id),   -- null darf für nicht zugeordnete Zeilen mehrfach vorkommen
  foreign key (organization_id, fixture_id)
    references public.fixtures(organization_id, id) on delete cascade,
  foreign key (organization_id, player_id)
    references public.playerboard_players(organization_id, id) on delete set null (player_id),
  unique (organization_id, fixture_id, id)
);

create table public.playerboard_veo_player_stats (
  organization_id uuid not null, assignment_id uuid not null,
  fixture_id uuid not null, stat_type text not null,
  category text not null, value numeric not null,
  primary key (assignment_id, stat_type),
  foreign key (organization_id, fixture_id, assignment_id)
    references public.playerboard_veo_player_assignments(organization_id, fixture_id, id) on delete cascade
);
```

RLS: Lesen über `authz.can_view_playerboard_stats` aus 052, also innerhalb der Mannschaft für alle mit `training.view` (Spieler sehen die Werte ihrer Mitspieler, Betreiberentscheidung 2026-10-05) und darüber hinaus nach der wirksamen `stats_visibility` der Mannschaft. Zuordnung ändern mit `training.manage`, Verbindung verwalten mit `integration.manage` **oder** `playerboard.manage` auf Team-Ebene (Trainer verbinden heute selbst; siehe „Offene Entscheidungen“). Jede Policy zusätzlich mit `authz.module_enabled(…, 'playerboard')`.

Das Session-Cookie liegt verschlüsselt über `integration_sources.credentials_secret_id` in SecretBox, nie in einer Tabellenspalte und nie im Log. E-Mail und Passwort werden **nie** gespeichert, sondern nur für den einmaligen Login verwendet.

## Umsetzung

### PR 1 – Veo-Client als Paket

`packages/veo-client`: Login, Token-Tausch, Vereins-/Mannschafts-/Spielliste, Statistikabruf und die beiden Mapper aus playerboard übernehmen, jeweils mit Zod-Schema an der Systemgrenze. Ausgehende Aufrufe nur an die feste Liste `auth.veo.co`, `app.veo.co` (keine vom Nutzer gesetzte URL, deshalb reicht eine Host-Allowlist; `packages/outbound-fetch` nur, falls die Hosts je konfigurierbar werden). Tests gegen aufgezeichnete, anonymisierte Antworten aus playerboard (`research.md` §§1–2 des Features 004).

### PR 2 – Schema, Verbindung, Sync im Worker

- Migration wie oben, pgTAP-Isolation.
- `POST /v1/playerboard/veo/login` (E-Mail/Passwort → Cookie → SecretBox, Rückgabe der wählbaren Veo-Vereine und -Mannschaften), `POST /v1/playerboard/veo/link` (legt Integrationsquelle und Link an).
- Worker-Job `playerboard.veo.sync` mit ID-only-Nachricht (`integrationSourceId`), ausgelöst per Cron der Quelle oder manuell über den bestehenden Sync-Endpunkt mit `Idempotency-Key` (Paket 026). Erster Lauf importiert die ganze Historie (playerboard 003 FR-005).
- Abgelaufenes Cookie: Lauf endet mit `auth_expired`, die Quelle zeigt „neu verbinden“, der `team_manager` bekommt nach drei Fehlläufen in Folge eine Benachrichtigung (Ersatz für `veo_sync_status.consecutive_failures`).

### PR 3 – Oberfläche

- `/playerboard/veo`: verbinden, Mannschaft wählen, letzter Lauf, neu verbinden
- Spielliste und Spieldetail mit Mannschafts- und Spielerwerten; Zuordnung der Rückennummern je Spiel (einzeln und gesammelt, wie playerboard `player-assignment-bulk`)
- Saisonübersicht je Spieler auf `/playerboard` (kumulierte Werte im Saisonzeitraum aus `playerboard_settings.season_start`)
- Reiter „Veo“ auf der öffentlichen Mannschaftsseite `/mannschaft/[orgSlug]/[teamSlug]`, Schalter dafür in `/playerboard/einstellungen`
- Spiele aus Veo erscheinen ohne weiteres Zutun im Rahmen-Kalender

### PR 4 – playerboard abschalten

Erst wenn 052 und 053 im Produktivbetrieb laufen:

- Deployment von playerboard auf haex.space stoppen, Container und Supabase-Instanz entfernen (`ansible`-Repo, Rolle playerboard)
- Repository `haexhub/playerboard` archivieren, README mit Verweis auf Vereinsfunk
- DNS bzw. Weiterleitung der alten öffentlichen Ranglisten-URLs entscheiden (siehe unten)

## Verifikation

- `packages/veo-client`: Mapper-Tests gegen die aufgezeichneten Antworten; Login/Token mit Fake-Server.
- pgTAP: Isolation, `matched_manually` bleibt nach erneutem Sync erhalten, ein Kader-Eintrag kann nicht zwei Rückennummern im selben Spiel haben.
- Worker-Test: Spielerwerte schlagen fehl → kein `fixtures`-Update und keine Mannschaftswerte für dieses Spiel; zwei parallele Läufe → genau einer läuft (026).
- Zusammenführung: vorhandenes iCal-Spiel bekommt Ergebnis und Statistik, kein Duplikat; mehrdeutiger Treffer erzeugt einen Konflikt.
- Öffentliche Veo-Werte: ohne Schalter oder bei `public_sharing_allowed = false` leer; die Ausgabe enthält keine Klarnamen (Test sucht die Namen der Testpersonen im JSON).
- Manuell gegen den echten Veo-Account des Vereins (wie playerboard am 2026-09-25), weil es keine Testumgebung von Veo gibt.

## Risiken und offene Entscheidungen

- **Inoffizielle API.** Veo kann die interne Schnittstelle jederzeit ändern. **Betreiberentscheidung 2026-10-05:** Die Veo-Anbindung ist trotzdem für jeden Verein mit aktivem Modul `playerboard` freigeschaltet, ohne Pilot- oder Tarifschalter. Absicherung stattdessen technisch: Zod-Schemas an der Grenze (`packages/veo-client`) lassen einen Lauf bei geänderter Antwortform sauber mit `upstream_changed` scheitern statt falsche Werte zu schreiben, und der Plattform-Admin sieht fehlschlagende Veo-Läufe vereinsübergreifend.
- **Wer verbindet Veo?** In playerboard tut es der Trainer. In Vereinsfunk gehören Integrationsquellen der Abteilung (`integration.manage` hat nur `department_admin`). Empfehlung: Trainer dürfen über `playerboard.manage` genau eine Veo-Quelle für die eigene Mannschaft anlegen; andere Integrationsarten bleiben bei der Abteilung.
- **Veo-Spiele ohne Gegenstück im Spielplan** legen neue `fixtures` an. Ein Verein, der seinen Spielplan sorgfältig per iCal pflegt, will vielleicht nur zusammenführen und nie anlegen. Empfehlung: Schalter an der Quelle „nur zu vorhandenen Spielen zuordnen“, Standard aus.
- **Alte öffentliche URLs** (`/public/<slug>/ranking` auf haex.space). Da es keine relevanten Nutzer gibt, reicht vermutlich eine pauschale Weiterleitung auf die Vereinsfunk-Startseite.

## Umsetzung PR 1: Ergebnis und Abweichungen vom Plan

Umgesetzt am 2026-10-08: `packages/veo-client`, ohne Aufrufer.
- **`captureSessionViaLogin()`:** Anmeldung über Veos Login-Seite im Browser, Ergebnis ist das Session-Cookie.
- **`exchangeSessionCookieForToken()`:** stille OIDC-Anmeldung mit PKCE.
- **Listen:** `listOwnClubs()`, `listClubTeams()`, `listMatches()`.
- **Werte:** `fetchTeamStats()`, `fetchPlayerStats()`.
- **Parser:** `parseMatchList()`, `parseTeamStats()`, `parsePlayerStats()`, jeweils mit Zod-Schema.
- **Fehler** als `VeoError` mit fachlichem Code:
  - `login_failed`;
  - `auth_expired` (Cookie erneuert sich nicht, Token abgelehnt, HTTP 401/403);
  - `upstream_changed` (Antwortform geändert, Login-Formular fehlt);
  - `upstream_error` (sonstige HTTP-Fehler, Netzwerk, Zeitüberschreitung nach 30 s).
- **Ausgehende Aufrufe** gehen nur per HTTPS an `auth.veo.co` und `app.veo.co`. Weiterleitungen werden nicht verfolgt (`redirect: 'manual'`).

Verifiziert:
- 23 Vitest-Fälle gegen die aus playerboard übernommenen Aufnahmen und gegen Fakes für OIDC, API und Browser.
- Alle Fälle der playerboard-Tests sind übernommen: verschachtelte `team.id`, kuratierte Spielerwerte, führende Nullen und ungültige Rückennummern, doppelte Einträge, geerbte Schlüssel, `team_id` im Spieleraufruf.
- `pnpm lint`, `typecheck`, `test` (alle 39 Tasks) und `build` grün.
- **Gegen den echten Veo-Account des Vereins geprüft** (2026-10-08). Das Skript lag außerhalb des Repositorys, die Zugangsdaten kamen aus der lokalen `.env` von playerboard und nichts davon wurde ausgegeben. Alle Schritte erfolgreich:
  - Anmeldung im Browser (Chromium, etwa 6 s) und Token-Tausch;
  - 1 Verein, 8 Mannschaften;
  - 9 Spiele, alle mit Analyse und Ergebnis;
  - Mannschaftswerte eines Spiels (30 Werte, beide Seiten, Spiel-ID aus der Antwort passt);
  - Spielerwerte eines Spiels (24 Rückennummern, jeweils alle 9 kuratierten Werte).

Abweichungen:

- **Browser von außen.** Veo hat keine Login-API; playerboard steuert dafür Chromium mit Playwright. Das Paket bekommt den Browser als Funktion übergeben (`LoginBrowser`, der benutzte Ausschnitt der Playwright-API) und hängt selbst nicht an Playwright. Wo die Anmeldung läuft (API oder Worker, der schon Chromium mitbringt), entscheidet PR 2.
- **Strengere Erfolgsprüfung beim Login.** Die Anmeldung gilt erst als erfolgreich, wenn die Seite auf `app.veo.co` außerhalb von `/accounts/login` landet (playerboard prüfte nur den Host).
- **Ganze Historie seitenweise.** playerboard las nur die ersten 50 Spiele. `listMatches()` blättert mit `page`, bis eine Seite kürzer ist, nichts Neues bringt oder Veo mit `404` antwortet.
  - Live belegt: Mit 5 Spielen je Seite liefern zwei Seiten dieselben 9 Spiele wie eine Seite mit 50. Veo wertet `page` also aus, und der erste Sync holt wirklich die ganze Historie.
  - Würde Veo den Parameter künftig ignorieren, endet die Schleife nach der ersten Seite; das Verhalten wäre dann dasselbe wie in playerboard.
- **Werte je Spiel.**
  - Mannschaftswerte werden der `match_id` der Antwort zugeordnet statt einer vom Aufrufer übergebenen Spiel-ID.
  - Spielerwerte kommen mit genau einem Spiel je Aufruf, weil Veo bei `group_by: player` über alle übergebenen Spiele zusammenfasst (`cross_match`).
- **Kaderzuordnung nicht im Paket.** `parsePlayerStats()` liefert Werte je Rückennummer. Die Zuordnung zu `playerboard_players` samt `matched_manually` gehört zum Sync (PR 2).
- **Aufnahmen anonymisiert.** Veo-IDs, Vereins- und Gegnernamen sind ersetzt (`packages/veo-client/src/__fixtures__`); Struktur und Werte sind unverändert.

## Umsetzung PR 2: Ergebnis und Abweichungen vom Plan

Umgesetzt am 2026-10-08.

**Datenbank** (`2026101201_playerboard_veo.sql`):
- **Tabellen:**
  - `integration_source_secrets`
  - `playerboard_veo_links`
  - `playerboard_veo_matches`
  - `playerboard_veo_match_stats`
  - `playerboard_veo_player_assignments`
  - `playerboard_veo_player_stats`
- **Funktionen**, jeweils nur für `service_role`:
  - `playerboard_veo_link_team`
  - `enqueue_integration_sync`
  - `playerboard_veo_enqueue_scheduled_syncs`
  - `playerboard_veo_apply_match`
  - `playerboard_veo_finish_sync`

**API:**
- `POST /v1/playerboard/veo/login` und `POST /v1/playerboard/veo/link` (beide `playerboard.manage`);
- `GET /v1/playerboard/veo/status` (`training.view`);
- `POST /v1/playerboard/veo/sync` (`playerboard.manage`, `Idempotency-Key`).

**Worker:**
- `VeoSyncExecutor` für den bisher nur reservierten Workflow `sync-integration-source`;
- Cron `playerboard-veo-sync-schedule`.

**Neues Paket:** `packages/mailer`.

Verifiziert:
- **pgTAP** `playerboard_veo.test.sql` (24 Fälle):
  - Verbinden legt Quelle, Geheimnis und Verbindung an; neu verbinden behält die Quelle.
  - Genau ein aktiver Lauf, der Auftrag trägt nur IDs.
  - Ein vorhandenes Spiel bekommt das Ergebnis ohne Duplikat und ohne geänderte Stammdaten.
  - Ein neues Spiel gehört der Veo-Quelle; ein mehrdeutiger Treffer wird zum Konflikt.
  - Rückennummern werden gegen den Kader zugeordnet; `matched_manually` überlebt den nächsten Abgleich.
  - Ein Kader-Eintrag hat je Spiel nur eine Nummer.
  - Spieler sehen die Werte, die Nachbarmannschaft nicht, das Geheimnis niemand.
  - Hinweis genau beim dritten Fehllauf; ein Erfolg setzt die Serie zurück.
- **Worker-Tests** (7):
  - Alles oder nichts je Spiel bei fehlgeschlagenem Spielerabruf.
  - Ein abgelaufenes Cookie beendet den Lauf und benachrichtigt; Mail und Log enthalten kein Cookie.
  - Eine geänderte Antwortform bricht den Lauf ab.
  - Ein beendeter Lauf bleibt unberührt.
- **API-Tests** (14):
  - Rechte, falsches Passwort, Veo nicht erreichbar.
  - Link-Token fremder Person, abgelaufen oder manipuliert.
  - Das Cookie ist mit der Quellen-ID versiegelt.
  - Veo-Quelle über den Integrationsendpunkt.
- `pnpm lint`, `typecheck`, `test` (42 Tasks), `build` und alle pgTAP-Dateien (53 Dateien, 1315 Fälle) grün.
- **Live gegen den Veo-Account des Vereins** (2026-10-08, lokaler Stack, nur Anzahlen ausgegeben):
  - Anmeldung über die lokale API in 6,3 s: 1 Verein, 8 Mannschaften.
  - Verbinden mit der C-Jugend und erster Abgleich mit dem echten Worker-Code: 7 Spiele angelegt (alle mit Ergebnis), 210 Mannschaftswerte, 23 Rückennummern, 918 Spielerwerte.
  - Alle 5 Kader-Nummern der Testmannschaft wurden automatisch zugeordnet.
  - Ein zweiter, manueller Abgleich aktualisierte dieselben 7 Spiele ohne Duplikat.
  - Das Cookie liegt nur verschlüsselt in der Datenbank.
  - Das Spiel erscheint im Rahmen-Kalender.
  - Hatchet lief lokal nicht. Der Executor wurde deshalb direkt mit der Lauf-ID aufgerufen; der Weg über `workflow_outbox` ist durch pgTAP und Unit-Tests abgedeckt.

Abweichungen:

- **Anmeldung in der API.** Wie in playerboard startet die API für den Login ein unsichtbares Chromium; das API-Image installiert es wie der Worker (`PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`).
  - Es laufen höchstens zwei Anmeldungen gleichzeitig, sonst `503 veo_login_busy`.
  - Zwischen Login und Auswahl der Veo-Mannschaft trägt der Browser das Cookie als SecretBox-Token: 15 Minuten gültig, an Mannschaft und Person gebunden, mit der Liste der bei der Anmeldung gesehenen Veo-Mannschaften.
- **Geheimnis in eigener Tabelle.** Einen allgemeinen Secret-Speicher gab es nicht. `integration_source_secrets` hängt an der Quelle; `credentials_secret_id` zeigt auf die Zeile. Das AAD ist `integration-source:<id>`.
- **Eigene Zuordnung Veo-Spiel ↔ Spielplan** (`playerboard_veo_matches`) statt `fixtures.external_id`.
  - Grund: Ein angehängtes iCal-Spiel behält seine Quelle und wird trotzdem beim nächsten Lauf wiedergefunden.
  - Die Zuordnung hängt an der Mannschaft. Wer Veo neu verbindet, findet dieselben Spiele wieder.
  - Die Werte-Tabellen tragen `team_id` mit, damit die Policies ohne Join auskommen.
- **Zusammenführung strenger als geplant.**
  - Kandidaten: dieselbe Mannschaft, ±3 Stunden um den Veo-Start, Heim/Auswärts passend. Bei mehreren entscheidet der Gegnername.
  - Ein fremdes Spiel bekommt nur ein *fehlendes* Ergebnis. Ein eingetragenes Ergebnis und die Stammdaten bleiben unangetastet.
  - Ein mehrdeutiger Treffer wird zum Konflikt `ambiguous_match`, und das Spiel bleibt in diesem Lauf weg. Eine Auswahl des passenden Spiels fehlt noch (PR 3); bis dahin lässt sich ein solcher Konflikt nur dauerhaft ignorieren.
  - Veo legt Spiele an, nimmt aber nie welche aus dem Spielplan.
  - Der Schalter „nur zu vorhandenen Spielen zuordnen“ ist nicht gebaut.
- **Nur analysierte Spiele mit Endstand** werden übernommen (wie playerboard); die übrigen zählen als übersprungen.
- **Rückennummern:**
  - Offene, nicht von Hand gesetzte Nummern werden bei jedem Lauf erneut gegen den Kader geprüft. playerboard prüfte nur beim ersten Mal; ein später nachgetragener Kader greift also auch für alte Spiele.
  - Haben zwei aktive Spieler dieselbe Nummer, bleibt sie offen.
  - Liefert Veo eine Nummer nicht mehr, verschwindet sie samt Werten.
- **Lauf im Worker:**
  - `enqueue_integration_sync` belegt den Lauf-Slot (026) und schreibt den ID-only-Auftrag in derselben Transaktion; API und Cron nutzen dieselbe Funktion.
  - Täglicher Abgleich um 05:00 UTC über einen eigenen Cron statt einer Auswertung von `sync_cron`. Die Quelle trägt `0 5 * * *` nur zur Anzeige.
  - Läufe, die länger als zwei Stunden hängen, gibt der Cron als `stale_run` frei.
  - Verbindungen mit `auth_expired` lässt der Cron aus, bis neu verbunden wird.
  - Scheitert ein einzelnes Spiel, werden die übrigen trotzdem geschrieben und der Lauf endet als `failed` (wie playerboard). `auth_expired` und `upstream_changed` brechen den ganzen Lauf ab.
  - Fachliche Fehler lassen den Workflow nicht scheitern, weil eine Wiederholung durch Hatchet an einem abgelaufenen Cookie nichts ändert.
- **Benachrichtigung per Mail** über denselben SMTP-Server wie die API.
  - Der Versand liegt jetzt in `packages/mailer`.
  - Der Worker liest `EMAIL_PROVIDER`, `SMTP_*` und `WEB_BASE_URL`. **Für das Deployment müssen diese Variablen auch beim Worker gesetzt werden**; ohne `smtp` landet nur der Betreff im Log.
  - Beim dritten Fehllauf in Folge geht genau eine Mail an die `team_manager` der Mannschaft, die nächste erst nach einem erfolgreichen Lauf.
  - Der Link in der Mail zeigt auf `/playerboard/veo` (PR 3).
- **Integrationsseite:** Der bestehende Sync-Endpunkt reiht Veo-Quellen für den Worker ein (`202`). `/integrationen` zeigt dafür „Abgleich gestartet“ statt Trockenlauf und Übernehmen.
- **Noch nicht in PR 2:**
  - Korrektur der Zuordnung per API (Policy und Spaltenrecht sind angelegt);
  - die öffentliche Funktion `playerboard_public_veo_stats`;
  - die vereinsübergreifende Sicht des Plattform-Admins auf fehlschlagende Veo-Läufe.

## Umsetzung PR 3: Ergebnis und Abweichungen vom Plan

Umgesetzt am 2026-10-08.

**Datenbank** (`2026101301_playerboard_veo_views.sql`):
- `playerboard_veo_team_matches` liefert alle Spiele einer Mannschaft samt Mannschafts- und Spielerwerten als ein JSON, mit Namen; Zugriff wie die übrigen Kennzahlen.
- `playerboard_public_veo_stats` liefert dasselbe öffentlich: ohne IDs, Spieler nur als „#7 M. K.“ bzw. „#7“.
- `playerboard_veo_assign_jersey` ordnet eine Nummer zu, auf Wunsch auch in allen Spielen, in denen sie noch offen ist.
- `playerboard_veo_resolve_conflict` löst ein mehrdeutiges Spiel auf.
- `playerboard_veo_apply_match` beachtet aufgelöste Konflikte und merkt sich Kandidaten und Veo-Start.

**API:**
- `GET /v1/playerboard/teams/:teamId/veo/matches`
- `PUT /v1/playerboard/veo/assignments`
- `GET /v1/playerboard/veo/conflicts`
- `POST /v1/playerboard/veo/conflicts/:id/resolve`
- `GET /v1/public/playerboard/:orgSlug/:teamSlug/veo`
- Die öffentliche Mannschaftsinfo trägt jetzt die Zeitzone des Vereins.

**Web:**
- `/playerboard/spiele` für alle mit Einblick in die Kennzahlen:
  - Saisonbilanz, Tore, Schüsse, Fouls;
  - Werte je Spieler über die Saison;
  - Spielauswahl mit Mannschaftswerten (wir/Gegner nach Kategorie) und Spielerwerten;
  - für Trainer die Zuordnung der Rückennummern direkt in der Tabelle.
- `/playerboard/veo` für `playerboard.manage`:
  - Status, Anmelden, Auswahl der Veo-Mannschaft, neu verbinden, „Jetzt abgleichen“ (verfolgt den Lauf), Verlauf;
  - mehrdeutige Spiele zuordnen, neu anlegen oder auslassen.
- Abschnitt „Spiele der Saison · Veo“ auf `/playerboard`.
- Reiter „Spiele“ auf der öffentlichen Mannschaftsseite.
- Schalter „Spiele und Veo-Werte zeigen“ in den Einstellungen.
- Navigation: „Spiele“ für alle, „Veo“ unter Verwaltung.

Verifiziert:
- **pgTAP** `playerboard_veo_views.test.sql` (16 Fälle):
  - Sicht und Zeitraum; das Ergebnis erscheint aus eigener Sicht, auch auswärts.
  - Die Nachbarmannschaft liest nichts; Spieler dürfen nicht zuordnen.
  - Zuordnung für alle offenen Spiele; ein Spieler hat je Spiel nur eine Nummer.
  - Manuelle Zuordnung und manuelles Lösen überleben den Abgleich.
  - Öffentlich nur mit Schalter, ohne Namen und IDs.
  - Kandidaten und Start im Konflikt; die Auflösung hängt das Spiel beim nächsten Lauf an.
- **API-Tests:** 9 neue Fälle zu Rechten, Zeitraum, Zuordnung inklusive 409, Konflikten und öffentlichen Veo-Werten.
- **Web:** Unit-Tests zu Bilanz, Saisonwerten (Summe, Maximum, Mittel), Einheiten und Gegenüberstellung.
- **Gesamtlauf:** `pnpm lint`, `typecheck`, `test` (42 Tasks), `build` grün; alle pgTAP-Dateien grün (54 Dateien, 1333 Fälle).
- **Browser** mit echten Veo-Daten der C-Jugend (lokal):
  - Spiele, Veo-Status, Übersicht und öffentlicher Reiter laden.
  - Die Zuordnung „#1 → Emil“ wurde in 5 Spielen übernommen und ließ sich wieder lösen.
  - Die öffentliche Seite zeigt keine Namen (9 Kürzel).
  - Bei 390 px gibt es kein seitliches Scrollen.

Abweichungen und Funde:

- **Hotfix vorab (#217):** Die beim Review von #216 geänderte Migration verwies auf `teams(organization_id, id)` ohne passenden Schlüssel und ließ sich auf keiner Datenbank einspielen. Der Fix ergänzt den Schlüssel in derselben Migration. Dieser PR baut darauf auf.
- **Ein zweiter Versuch je Spiel bei `upstream_error`.**
  - Live antwortete Veo beim Abruf einzelner Spiele sporadisch mit einem Serverfehler, jedes Mal bei einem anderen Spiel.
  - Alles-oder-nichts griff korrekt, aber fast jeder Lauf endete als fehlgeschlagen, und nach drei Läufen wäre eine Mail an den Trainer gegangen.
  - Jetzt wartet der Worker 2 s und versucht das Spiel einmal neu. Ins Log kommt nur der HTTP-Status.
- **Lesen per Funktion statt per Tabellenabfragen:** ein JSON je Mannschaft statt vieler PostgREST-Abfragen mit 1000-Zeilen-Grenze. Eine Saison hat schnell mehr als 1000 Spielerwerte.
- **Mehrdeutige Spiele** werden über den vorhandenen Konflikt aufgelöst (`resolution`, `local_id`), ohne neue Tabelle:
  - Die Kandidaten stehen in `current_value`, der Veo-Start in `incoming_value`.
  - Ältere Konflikte aus PR 2 haben keine Kandidaten. Sie lassen sich als neues Spiel anlegen oder auslassen.
- **Saisonwerte je Spieler nur für zugeordnete Nummern** (wie playerboard). Die Seite nennt die Zahl der offenen Nummern. Öffentlich erscheinen auch offene Nummern als „#7“.
- **Saisonübersicht:** Wie im Plan steht sie auf `/playerboard`. Ausführlich mit Spieldetails liegt sie auf der neuen Seite `/playerboard/spiele`.
- **Feste Mannschaftskennzahlen:** Auf einen Blick zeigt die Saison Bilanz, Tore, Schüsse und Fouls; alle übrigen Werte stehen im Spiel. Die Mannschaftswerte der Saison sind Summen; eine Gegenüberstellung mit dem Gegner gibt es nur je Spiel.
- **Layout-Fund:** Die öffentliche Seite bemisst ihre Breite nach dem Inhalt. Breite Tabellen und Auswahlfelder trugen deshalb zur Mindestbreite bei und schoben die Seite auf. Die Tabelle scrollt jetzt in sich (`w-0 min-w-full`), die Spielauswahl ist schrumpffähig.

## PR 4: Vorbereitung und Entscheidungen

Stand 2026-10-09. Vorbereitet, aber nicht ausgeführt: Die Mannschaft nutzt in Produktion noch playerboard (Betreiber, 2026-10-09).

**Betreiberentscheidungen (2026-10-09):**
- **Daten:** Vor dem Entfernen werden ein Datenbank-Dump (`pg_dump`, Custom-Format) und ein Archiv der Trainingsfotos nach `~/backups/playerboard` auf haex.space gesichert. Es gibt weiterhin keinen Datenumzug.
- **Alte Adressen:** `playerboard.de` leitet pauschal und dauerhaft (301) auf `https://vereinsfunk.haex.space/` weiter. Die Supabase-Subdomains entfallen.
- **Repository:** `haexhub/playerboard` bekommt einen Hinweis im README und wird danach archiviert.

**Vorbereitet:**
- haexhub/ansible#148 (sofort mergebar): Der Vereinsfunk-Worker bekommt `EMAIL_PROVIDER`, `SMTP_*` und `WEB_BASE_URL`. Ohne sie würde der Veo-Hinweis aus PR 2 in Produktion nur ins Log geschrieben.
- haexhub/ansible#149 (Entwurf): Schalter `playerboard_retired`.
  - Sichert die Daten und bricht ohne nicht-leeren Dump ab.
  - Entfernt den Veo-Cron, stoppt App- und Supabase-Stack und startet die Weiterleitung.
  - `playerboard_purge_data` löscht Volumes und Verzeichnisse erst in einem eigenen Lauf, nachdem der Dump geprüft ist.
- haexhub/playerboard#86 (Entwurf): Hinweis im README.

**Reihenfolge beim Umstieg:**
1. Die Mannschaft legt in Vereinsfunk Kader und Kategorien an und verbindet Veo; der erste Abgleich holt die ganze Spielhistorie.
2. #149 und #86 mergen, Playbook für haex.space ausführen, Dump prüfen (`pg_restore --list`).
3. Repository archivieren.
4. In einem späteren Lauf `playerboard_purge_data: true`.

