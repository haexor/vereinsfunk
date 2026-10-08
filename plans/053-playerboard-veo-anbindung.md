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
- Gegen den echten Veo-Account noch nicht geprüft; das folgt mit PR 2 („Manuell gegen den echten Veo-Account“, siehe Verifikation).

Abweichungen:

- **Browser von außen.** Veo hat keine Login-API; playerboard steuert dafür Chromium mit Playwright. Das Paket bekommt den Browser als Funktion übergeben (`LoginBrowser`, der benutzte Ausschnitt der Playwright-API) und hängt selbst nicht an Playwright. Wo die Anmeldung läuft (API oder Worker, der schon Chromium mitbringt), entscheidet PR 2.
- **Strengere Erfolgsprüfung beim Login.** Die Anmeldung gilt erst als erfolgreich, wenn die Seite auf `app.veo.co` außerhalb von `/accounts/login` landet (playerboard prüfte nur den Host).
- **Ganze Historie seitenweise.** playerboard las nur die ersten 50 Spiele. `listMatches()` blättert mit `page`, bis eine Seite kürzer ist, nichts Neues bringt oder Veo mit `404` antwortet.
  - Ob Veo `page` auswertet, ist unbelegt.
  - Ignoriert es den Parameter, endet die Schleife nach der ersten Seite; das Verhalten ist dann dasselbe wie in playerboard.
- **Werte je Spiel.**
  - Mannschaftswerte werden der `match_id` der Antwort zugeordnet statt einer vom Aufrufer übergebenen Spiel-ID.
  - Spielerwerte kommen mit genau einem Spiel je Aufruf, weil Veo bei `group_by: player` über alle übergebenen Spiele zusammenfasst (`cross_match`).
- **Kaderzuordnung nicht im Paket.** `parsePlayerStats()` liefert Werte je Rückennummer. Die Zuordnung zu `playerboard_players` samt `matched_manually` gehört zum Sync (PR 2).
- **Aufnahmen anonymisiert.** Veo-IDs, Vereins- und Gegnernamen sind ersetzt (`packages/veo-client/src/__fixtures__`); Struktur und Werte sind unverändert.
