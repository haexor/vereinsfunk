# Data Model: Veo-Analyse im PlayerBoard

Migration `supabase/migrations/2026102102_playerboard_veo_analysis.sql` (PR 1); die Lesefunktionen folgen mit den Story-PRs in eigenen Migrationen. Alle neuen Tabellen:
- tragen `organization_id` und `team_id`,
- hängen mit zusammengesetztem Fremdschlüssel `(organization_id, team_id, fixture_id)` an `playerboard_veo_matches` und werden mit dem Spiel gelöscht (`on delete cascade`),
- haben `enable` und `force row level security`, sind für `anon` gesperrt und für `authenticated` nur lesbar,
- dürfen mit `select` gelesen werden, wenn `authz.can_view_playerboard_stats(team_id)` gilt,
- werden nur vom Worker über `service_role` geschrieben. Ausnahme ist `playerboard_veo_team_views`.

## Geänderte Tabellen

### `playerboard_veo_matches` (Paket 053)

| Spalte | Typ | Regel |
|---|---|---|
| `veo_match_slug` | `text` null | 1–200 Zeichen. Wird für den Link ins Veo-Video gebraucht (R-11) und beim nächsten Analyseabruf gefüllt. |
| `analysis_status` | `text` not null default `'none'` | Erlaubt sind `none`, `pending`, `complete`, `unavailable`. |
| `analysis_fetched_at` | `timestamptz` null | Zeitpunkt des letzten erfolgreich geschriebenen Analysepakets. |

Zustände von `analysis_status`:
- **`none`**: Es wurde noch kein Analysepaket geholt.
- **`pending`**: Veo rechnet noch, oder Veo meldet keine Halbzeiten. Das Feld `is_confirmed` der Halbzeiten zählt nicht: Laut Testabruf ist es `false`, obwohl Veo die Analyse liefert.
- **`complete`**: Alles, was Veo für dieses Spiel liefert, ist gespeichert.
- **`unavailable`**: Veo liefert für dieses Spiel keine Analyse, etwa bei Analyseversion 1 ohne Orte oder ohne Abo.

Übergänge:
- `none` geht nach `pending`, `complete` oder `unavailable`.
- `pending` geht nach `complete` oder `unavailable`.
- `complete` bleibt `complete`. Ein neuer Abruf innerhalb von 14 Tagen oder auf Anforderung ersetzt den Stand.

### `playerboard_veo_links` (Paket 053)

| Spalte | Typ | Regel |
|---|---|---|
| `analysis_refresh_requested_at` | `timestamptz` null | Wird durch „Analyse neu laden“ gesetzt, gilt für die ganze Mannschaft. Der nächste Abgleich holt die Analyse aller Spiele neu und leert das Feld (R-03). |

### `playerboard_veo_player_stats` (Paket 053)

| Spalte | Typ | Regel |
|---|---|---|
| `period_values` | `jsonb` not null default `'[]'` | Array von `{period: int ≥ 1, value: number}`. |

Die gespeicherten Stat-Typen werden auf alle Typen aus Inventar §4.2.1 erweitert. `category` nimmt dann die Werte `general`, `physical`, `attacking`, `distribution`, `defending`, `set_pieces` und `goalkeeping` an.

## Neue Tabellen

### `playerboard_veo_match_analysis`: eine Zeile je Spiel

| Spalte | Typ | Regel |
|---|---|---|
| `fixture_id` | `uuid` PK | |
| `organization_id`, `team_id` | `uuid` not null | |
| `analytics_version` | `text` not null | Erlaubt sind `1`, `1.1`, `2`. |
| `periods` | `jsonb` not null | Array von `{number, startS, endS, ownSide: 'left'\|'right', confirmed}`, aufsteigend nach `number`. |
| `availability` | `jsonb` not null | Je Teil `{status: 'available'\|'unavailable'\|'pending', reason?}`. Teile sind `events`, `shots`, `heatmaps`, `tracking`, `passes`, `possession`, `passStrings`, `momentum`, `passingNetwork`, `report`. Daraus kommen die Hinweise aus FR-066. |
| `pass_possession` | `jsonb` null | Je Halbzeit und Mannschaft die Passanteile und Ballbesitzanteile je Drittel, die Passketten als `[länge, anzahl]`, Ballbesitz in Sekunden, angekommene Pässe und Ballgewinne. Bereits auf eigene Mannschaft und Gegner abgebildet. |
| `momentum` | `jsonb` null | Array von `[sekunden, wert]`. Positiv heißt Geschehen in der Gegnerhälfte der eigenen Mannschaft. Außerhalb der Halbzeiten steht `null`. |
| `passing_network` | `jsonb` null | Je Halbzeit und fürs ganze Spiel `{nodes: [{jersey, x, y}], edges: [{from, to, completed}]}`. Nur die eigene Mannschaft. |
| `report` | `jsonb` null | Teilmenge des Veo-Spielberichts (R-10) ohne Videos, Spieler nur mit Rückennummer. |
| `fetched_at` | `timestamptz` not null | |

### `playerboard_veo_events`: Ereignisse beider Mannschaften

| Spalte | Typ | Regel |
|---|---|---|
| `id` | `uuid` PK | |
| `organization_id`, `team_id`, `fixture_id` | `uuid` not null | |
| `veo_event_id` | `text` not null | Eindeutig je Spiel: `unique (fixture_id, veo_event_id)`. |
| `team_association` | `text` not null | `own` oder `opponent`. |
| `event_type` | `text` not null | Veo-Typ ohne `possession` und `*_target`: `FootballGoal`, `FootballShot`, `pass`, `tackle`, `duel`, `dribble`, `interception`, `loose`, `save`, `FootballFoul`, `FootballOutOfPlay`, `FootballKickOff`, `FootballGoalKick`, `FootballCornerKick`, `FootballFreeKick`, `FootballThrowIn`, `FootballPenaltyKick`. |
| `end_x`, `end_y` | `real` null | Nur bei `pass`: Ziel des Passes aus `receiver_x`/`receiver_z`, normiert wie `x`/`y`. |
| `receiver_jersey_number` | `integer` null | Nur bei `pass`. |
| `jersey_number` | `integer` null | ≥ 0. `null` heißt, das Ereignis ist keinem Spieler zugeordnet. |
| `period_number` | `smallint` not null | ≥ 1. |
| `period_time_ms`, `video_time_ms` | `integer` not null | ≥ 0. |
| `x`, `y` | `real` null | Beide gesetzt oder beide `null` (Ereignis ohne Ort), Wertebereich 0–1. Normiert nach R-06; der Worker begrenzt Veos Werte knapp außerhalb von 0–1 vorher auf diesen Bereich. |
| `outcome` | `smallint` null | Veo-Ausgang, 1 heißt Tor oder Erfolg. |
| `assist_jersey_number` | `integer` null | Nur bei Toren. |

Index auf `(organization_id, team_id, event_type)` für die Saison-Schusskarte.

Zuordnung zum Spieler: Beim Lesen wird die Zuordnung über `playerboard_veo_player_assignments (fixture_id, veo_jersey_number)` angehängt, nur bei `team_association = 'own'`. Eine geänderte Zuordnung wirkt dadurch sofort auf alle Karten (FR-023).

### `playerboard_veo_heatmaps`: Veo-Matrizen eigener Spieler

| Spalte | Typ | Regel |
|---|---|---|
| `organization_id`, `team_id`, `fixture_id` | `uuid` not null | |
| `jersey_number` | `integer` not null | ≥ 0. |
| `period_number` | `smallint` not null | 0 steht für das ganze Spiel, sonst ≥ 1. |
| `width`, `height` | `smallint` not null | > 0. |
| `cells` | `bytea` not null | Länge = `width` × `height`, zeilenweise. Normiert auf „eigene Mannschaft greift nach rechts an“, `direction_of_play` ist also schon angewendet. |
| `average_x`, `average_y` | `real` null | Durchschnittsposition, 0–1. |
| `seconds_played` | `integer` null | Gewicht für die Saisonsumme (R-05). |

Primärschlüssel `(fixture_id, jersey_number, period_number)`. Der Spieler wird wie bei den Ereignissen über die Zuordnung ermittelt.

### `playerboard_veo_tracks`: Positionsdaten (R-05, im Testabruf belegt)

Die Daten werden roh je Spielfeldseite gespeichert, ohne Bezug auf eigene Mannschaft oder Gegner. Die Zuordnung geschieht beim Lesen mit den aktuellen Halbzeiten (`own_side`). Eine spätere Seitenkorrektur in Veo braucht so kein Neuladen. Positionsdaten werden einmal je Spiel geholt.

| Spalte | Typ | Regel |
|---|---|---|
| `organization_id`, `team_id`, `fixture_id` | `uuid` not null | |
| `veo_track_id` | `integer` not null | ≥ 0. Veos Spur-ID. |
| `side` | `text` not null | `left` oder `right`, aus Veos Kategorie: 0 und 1 sind links, 2 und 3 rechts. Ball (6) und Schiedsrichter (4) werden nicht gespeichert. |
| `goalkeeper` | `boolean` not null | Kategorie 0 oder 2. |
| `jersey_number` | `integer` null | ≥ 0. Häufigste von Veo erkannte Rückennummer der Spur, `-1` wird zu `null`. |
| `start_s` | `integer` not null | ≥ 0. Erste Sekunde der Spur in Videozeit. |
| `samples` | `bytea` not null | Je Sekunde `x` und `y` als uint16 (0–65535 entspricht 0–1), in Kamera-Koordinaten. `0xFFFF`/`0xFFFF` steht für keinen Wert. Länge ist ein Vielfaches von 4. |

Primärschlüssel `(fixture_id, veo_track_id)`.

### `playerboard_veo_team_views`: Ansichtseinstellungen je Mannschaft

| Spalte | Typ | Regel |
|---|---|---|
| `team_id` | `uuid` PK | |
| `organization_id` | `uuid` not null | Fremdschlüssel `(organization_id, team_id)` auf `teams`. |
| `key_metrics` | `text[]` not null | 0–4 Einträge, jeder aus dem Kennzahlenkatalog. Leer heißt Veo-Standard. |
| `radar` | `jsonb` null | `{metrics: text[6], comparingTeamId: uuid\|null, ownRange: [date, date], comparingRange: [date, date]}`. |
| `updated_by` | `uuid` null | Fremdschlüssel auf `profiles`. |
| `updated_at` | `timestamptz` not null | |

Rechte:
- Lesen darf, wer `authz.can_view_playerboard_stats(team_id)` hat.
- Schreiben erfolgt nur über die RPC `playerboard_veo_save_team_views` und erfordert `training.manage`. Die RPC prüft auch, dass `comparingTeamId` im selben Verein liegt und dass die schreibende Person deren Werte sehen darf.

## Lesefunktionen (`security definer`, Prüfung `authz.can_view_playerboard_stats` vorab)

| Funktion | Liefert |
|---|---|
| `playerboard_veo_match_analysis(target_team_id, target_fixture_id)` | Ein JSON mit Spiel, Halbzeiten, Verfügbarkeit, Mannschafts- und Spielerwerten je Halbzeit (inkl. Zuordnung und Namen), Ereignissen beider Mannschaften (eigene mit `playerId`), Heatmap-Matrizen, Pass- und Ballbesitzdaten, Spielverlauf, Passnetz, Bericht |
| `playerboard_veo_match_tracks(target_team_id, target_fixture_id)` | Positionsdaten des Spiels als Spuren je Seite mit `periods`. Die Zuordnung zu eigener Mannschaft und Gegner macht `packages/domain` beim Lesen. Ohne gespeicherte Spuren liefert die Funktion eine leere Liste. |
| `playerboard_veo_team_matches(target_team_id, from_date, to_date, kinds text[], fixture_ids uuid[], last_n int)` (**bestehend, erweitert**) | Wie bisher je Spiel Kopfdaten sowie Mannschafts- und Spielerwerte. Neu sind die Filter, `kind`, `analysisStatus`, `analyticsVersion`, `periodValues` der Spielerwerte, die Drittel-Anteile und `personId`. Die Signatur mit drei Argumenten bleibt als Überladung, damit `/playerboard/spiele` und die öffentliche Ausgabe unverändert laufen. |
| `playerboard_veo_team_shots(target_team_id, from_date, to_date, kinds text[], fixture_ids uuid[], last_n int)` | Alle Schüsse und Tore der gefilterten Spiele mit Ort, Mannschaft und `playerId` (nur eigene). Grundlage für die Saison-Schusskarten. |
| `playerboard_veo_player_heatmaps(target_team_id, target_player_id, from_date, to_date, kinds text[], fixture_ids uuid[], last_n int)` | Matrizen des ganzen Spiels und Spielsekunden des Spielers je gefiltertem Spiel |
| `playerboard_veo_team_views(target_team_id)` | Einstellungen oder Standard |

Filterregeln (FR-030):
- `kinds` sind Spielarten aus `fixtures`.
- `last_n` begrenzt auf die letzten n Spiele.
- `fixture_ids` steht für die Einzelauswahl und gilt dann ausschließlich.
- Alle Funktionen beachten nur Spiele mit `analysis_status in ('complete', 'pending')` und lesen je Teil die `availability`.

## Schreibfunktion (nur `service_role`)

`playerboard_veo_apply_analysis(p_run_id uuid, p_fixture_veo_match_id text, p_analysis jsonb) returns text`:
- Prüft, dass der Lauf `running` ist und das Spiel zur Quelle des Laufs gehört.
- Ersetzt in einer Transaktion die Zeilen des Spiels in `playerboard_veo_match_analysis`, `playerboard_veo_events`, `playerboard_veo_heatmaps` und `playerboard_veo_tracks`.
- Setzt `analysis_status`, `analysis_fetched_at` und `veo_match_slug`.
- `tracks = null` lässt gespeicherte Positionsdaten stehen; sie werden einmal je Spiel geholt.
- Rückgabe: `written` oder `unknown_match`.

Die Eingabe wird vorher im Worker mit Zod geprüft. In SQL werden nur Wertebereiche und Pflichtfelder durch `check`-Constraints erzwungen.
