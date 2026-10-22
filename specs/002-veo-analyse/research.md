# Research: Veo-Analyse im PlayerBoard

Stand 2026-10-21, gegen `main` `cc7b95c`. Grundlage ist das Inventar der Veo-Web-App in [veo-ui-inventory.md](veo-ui-inventory.md). Es wurde aus den öffentlich ausgelieferten Programmdateien von `app.veo.co` abgeleitet (498 Chunks, Sentry-Release `24036065…`). Die Dateien wurden nur gelesen, nie ausgeführt.

Punkte mit **[Testabruf]** stützten sich zuerst nur auf den Code der Veo-App. Am 2026-10-21 wurden sie mit einem lesenden Testabruf belegt (T002): drei Spiele der C-Junioren, dazu zwei Spiele der 1. Männer als Gegenprobe, alle mit Analyseversion 2. Die Befunde stehen jeweils unter **Belegt**.

## Befund Testabruf (2026-10-21), Überblick

- Alle Endpunkte aus R-01 antworten, sobald die Bodies stimmen.
- **Freischaltfelder sind unzuverlässig.** `has_tracking_data` ist `false`, obwohl Positionsdaten kommen. `type` ist leer. `is_confirmed` der Halbzeiten ist `false`, obwohl Veo Analyse und Spielbericht liefert. Der Abgleich richtet sich deshalb nur nach den tatsächlichen Antworten und nach vorhandenen Halbzeiten, nicht nach diesen Feldern.
- **Trainingsaufnahmen** erscheinen in der Spieleliste mit Analyse, aber ohne Halbzeiten. Daraus entsteht `pending` mit `periods_missing` (Grenzfall aus der Spec).
- `lineup/players/` und `members/` antworten für dieses Konto mit `403`. Spieleridentität gibt es nur als `jersey_only`, die Zuordnung über Rückennummern bleibt wie in Paket 053.
- `key-metrics/` antwortet für die C1 mit `204`. Es gelten also Veos Standardkennzahlen.

## R-01 Welche Veo-Endpunkte

**Decision**: Wir nutzen nur die Endpunkte, die die Veo-Web-App selbst aufruft:

| Zweck | Endpunkt |
|---|---|
| Spiel, Slug, Freischaltungen | `GET /api/app/matches/{id}/` |
| Analysestand | `GET /api/app/matches/{id}/feature-processing-status/` und RAS `GET /recordings/{id}/analytics` (daraus die Analyseversion 1 / 1.1 / 2) |
| Halbzeiten und Seiten | `GET /api/app/matches/{slug}/periods/` |
| Mannschaftswerte je Halbzeit | `POST /api/app/analysis/stats/` `type: team_match` (wie heute) |
| Spielerwerte je Halbzeit | `POST /api/app/analysis/stats/` `type: match_all_players` (statt heute `cross_match`) |
| Ereignisse beider Mannschaften mit Ort | `GET /api/mes/v2/{id}/match-events?aggregatedDuels=true` |
| Spieler-Heatmaps | `POST /api/app/analysis/player-heatmaps/` `type: match_all_players`, einmal je Halbzeit und einmal fürs ganze Spiel |
| Pässe, Passketten, Ballbesitz je Drittel | RAS `GET /recordings/{id}/match-details?filters=…` |
| Spielverlauf | `GET /api/mes/v2/{id}/match-momentum` |
| Passnetz | `POST /api/mes/v2/{id}/passing-network` je Halbzeit |
| Spielbericht | `GET /api/app/analysis/matches/{id}/match-report/` |
| Positionsdaten für frei wählbare Zeitabschnitte | `GET /api/mes/v2/{id}/player-tracking?start=` (30-s-Fenster), siehe R-05 |

**Rationale**: Endpunkte, die die Web-App ruft, pflegt Veo mit. Etwa 15 Methoden im generierten Veo-Client haben keinen Aufrufer, darunter `v2GenerateMatchPlayerHeatmap(s)`, `own-player-stats` und `speed-zone-distribution`. Bei ihnen ist das Risiko größer, dass sie still verschwinden. `match-events` liefert beide Mannschaften mit Ort, Rückennummer und Halbzeit. Ein Aufruf deckt damit Schusskarte, Ereignisliste, Defensiv- und Passkarten ab.

**Alternatives considered**: `player-event-maps` je `map_kind` liefert nur die eigene Mannschaft und braucht sieben Aufrufe je Spiel. Er dient im Testabruf als Gegenprobe für die Koordinaten. Die ungenutzten MES-Methoden wurden verworfen (siehe oben).

**Belegt**:
- **`match-events`** liefert etwa 1.140 Ereignisse je Spiel, rund 1 MB.
  - Typen: `pass`, `possession`, `FootballOutOfPlay`, `tackle`, `tackle_target`, `FootballShot`, `FootballKickOff`, `interception`, `FootballGoal`, `FootballGoalKick`, `FootballThrowIn`, `duel`, `FootballCornerKick`, `FootballFoul`, `dribble`, `FootballFreeKick`, `dribble_target`, `loose`, `foul_target`, `save`, `FootballPenaltyKick`.
  - Felder: `id`, `eventType`, `team` (`Own`/`Opponent`), `playerJersey`, `periodId` (1, 2), `periodTimeMs`, `videoTimeMs`, `x`, `z`, `outcome` (1/0/`null`), `attributes`.
  - Pässe tragen als Attribute `receiver_x`, `receiver_z`, `receiver_jersey`, `distance` und `degree`. Daraus lassen sich Passrichtung und Passkarte ohne Spielbericht ableiten.
  - Gespeichert werden alle Typen außer `possession` und `*_target`. Die beiden sind Gegenstücke ohne eigene Anzeige in Veo.
- **Passnetz** verlangt `periods: [{ periodId: <Nummer>, ownSide }]` mit der Halbzeitnummer, nicht der ID. Ohne Halbzeiten kommt `400 periods must not be empty`.
- **`v2GenerateMatchPlayerHeatmap(s)` und `speed-zone-distribution`** liefern mit Veos eigener Body-Form `422`. Das bestätigt, dass sie nicht genutzt werden.

## R-02 Spiegeln statt live abfragen

**Decision**: Der Worker holt alle Analysedaten im bestehenden Veo-Abgleich und speichert sie in Supabase. API und Web lesen nur aus Supabase.

**Rationale**: Supabase ist die fachliche Source of Truth (AGENTS.md). Die Ansichten sollen auch funktionieren, wenn Veo nicht erreichbar ist (FR-060). Nur der Worker kennt das Veo-Cookie (Paket 053). Eine Live-Abfrage aus der API müsste das Cookie in jedem Request entschlüsseln.

**Alternatives considered**: Live-Proxy mit Cache in der API, abgelehnt aus den Gründen oben. Rohe Antworten als Blob speichern, abgelehnt: Die Lesefunktionen müssten Veos Formate kennen, und eine Formänderung bei Veo würde in der Oberfläche auffallen statt im Abgleich.

## R-03 Inkrementeller Abgleich

**Decision**: Die Analysedaten eines Spiels werden nur geholt, wenn mindestens einer dieser Fälle zutrifft:
- Für das Spiel ist noch keine Analyse gespeichert.
- Der gespeicherte Stand ist `pending`, weil Veo noch rechnete oder Halbzeiten fehlten.
- Der Anstoß liegt höchstens 14 Tage zurück. Das deckt Korrekturen in Veo ab.
- Ein Trainer hat „Analyse neu laden“ ausgelöst. Das ist ein Kennzeichen am nächsten Lauf.

Die heutigen Summenwerte bleiben bei jedem Lauf für alle Spiele, wie in Paket 053.

**Zeitbudget je Lauf** (nach dem lokalen Abgleich der C1 ergänzt):
- Analysepakete werden nur geholt, solange der Lauf jünger als 5 Minuten ist. Hatchets `executionTimeout` ist 10 Minuten. Ein Spiel mit Positionsdaten braucht etwa 2–3 Minuten, der erste Abgleich der C1 mit 8 Spielen dauerte 20 Minuten.
- Was nicht mehr ins Budget passt, holt der nächste Lauf nach, die neuesten Spiele zuerst. Der Lauf gilt deshalb nicht als fehlgeschlagen.
- „Analyse neu laden“ gilt für jedes Spiel, dessen Paket älter ist als die Anforderung. Ein unterbrochenes Neuladen setzt so fort, statt von vorn zu beginnen. Das Feld wird erst geleert, wenn kein Paket verschoben wurde.
- Ausbau: ein eigener Workflow je Spiel, falls Mannschaften mit langer Historie dazukommen.

**Fortschritt** (nach dem ersten Lauf in Produktion ergänzt, 2026-10-22): Ohne Zwischenstand sah ein Lauf von fünf bis zehn Minuten wie hängend aus, und die Seite fragte nur drei Minuten nach.
- Der Worker schreibt den Stand nach `integration_sync_runs.progress`: Spiele gesamt und fertig, geladene und verschobene Analysen, das Spiel in Arbeit mit Schritt und bei Positionsdaten die geladenen 30-s-Fenster.
- Wechsel von Spiel und Schritt schreibt er sofort, die Fenster höchstens alle 3 Sekunden. Ein Schreibfehler wird nur geloggt.
- Die Seite fragt bis 35 Minuten nach dem Start nach. Sie zeigt einen Balken, den Schritt und nach drei Minuten ohne neuen Stand einen Hinweis. Nach dem Lauf nennt sie die offenen Analysen, die der nächste Abgleich holt.

**Rationale**: Je Spiel kommen etwa 12 bis 14 Abrufe dazu, Tracking nicht mitgezählt. Bei 40 Spielen und täglichem Lauf wären das sonst über 500 Abrufe täglich gegen eine inoffizielle API. Korrekturen in Veo passieren erfahrungsgemäß in den Tagen nach dem Spiel.

**Alternatives considered**:
- Ein Änderungsmerkmal aus Veo auswerten. **Belegt**: Veo hat keins. `modifiedAt` war bei allen 1.140 Ereignissen `null`, `user_modified` der Halbzeiten ebenfalls. Die 14-Tage-Regel bleibt.
- Immer alles holen: abgelehnt, siehe oben.

Im Code bekommt das einen `ponytail:`-Kommentar: Obergrenze sind 14 Tage, der Weg zur Verbesserung ist ein Änderungsmerkmal.

## R-04 Alles oder nichts je Analysepaket

**Decision**: Die Analyse eines Spiels wird als ein Paket in einer Transaktion geschrieben (`playerboard_veo_apply_analysis`). Das passiert getrennt von den Summenwerten (`playerboard_veo_apply_match`, unverändert).

Fehler beim Abruf des Pakets:
- Ein Abruf schlägt fehl: Das Paket entfällt in diesem Lauf, der vorige Stand bleibt sichtbar.
- Ein Teil fehlt, weil Veo ihn für dieses Spiel nicht liefert (404 oder Freischaltung fehlt): Das ist kein Fehler. Der Teil wird als „nicht verfügbar“ mit Grund vermerkt.

Für Einzelabrufe gilt dieselbe Wiederholungsregel wie bisher (ein zweiter Versuch nach 2 s bei `upstream_error`).

**Rationale**: FR-061. Halbe Analysen, etwa eine Schusskarte ohne zugehörige Halbzeiten, wären falsch. Fällt die Analyse aus, sollen die bewährten Summenwerte trotzdem bleiben.

**Alternatives considered**: alles in `playerboard_veo_apply_match`. Abgelehnt, weil ein fehlender Spielbericht dann auch Ergebnis und Summenwerte blockieren würde.

## R-05 Heatmaps und frei wählbare Zeitabschnitte

**Decision**:
- **Spieler-Heatmap je Halbzeit und ganzes Spiel**: Die Matrix kommt von Veo (`player-heatmaps`, base64 uint8, `width` × `height`, `direction_of_play`) und wird unverändert gespeichert. Das ist die exakte Veo-Ansicht.
- **Mannschaft und Zeitabschnitte in Minutenschritten** (FR-012, FR-022): Der Worker holt die Positionsdaten (`player-tracking`), verdichtet sie auf eine Probe je Sekunde und speichert sie kompakt je Spur. Das Web rechnet daraus die Heatmap für jeden gewählten Abschnitt. Gezeichnet wird nach Veos Rezept: Raster 60 × 30, Weichzeichnen mit σ 0,8, bilineares Hochskalieren, Werte unter 5 % transparent, Gamma 0,8, Farbverlauf Grün → Gelb → Orange.
- **Saison-Heatmap eines Spielers**: Die Matrizen der Spiele werden nach Spielsekunden gewichtet summiert und neu normiert.

**Rationale**: Veo rendert die Mannschafts-Heatmap als Bild und Zeitabschnitte nur auf Anfrage. Beides lässt sich nicht im Voraus für jeden Abschnitt speichern. Aus Positionsdaten lässt sich jeder Abschnitt offline und ohne Abweichung in der Lage berechnen. Heatmaps sind Bilder. SC-001 vergleicht Zahlen, Zonenanteile und Ereignisse, keine Pixel.

**Alternatives considered**:
- Je Minute eine Veo-Matrix holen und addieren: 90 Abrufe je Spieler und Spiel. Außerdem sind die Matrizen je Abruf normiert und deshalb nicht summierbar.
- Das Mannschaftsbild je Halbzeit speichern: privates Medium ohne Zeitabschnitt, deckt FR-012 nicht.

**Belegt**:
- **`player-tracking` ist für die C1 verfügbar.**
  - Ein Abruf liefert ein 30-s-Fenster mit 75 Bildern (alle 0,4 s, 2,5 Hz).
  - Je Bild gibt es 20–26 Objekte als `[spurId, kategorie, x, y, rückennummer, distanz, tempo, zone]`. Die Kategorien sind 0 Torwart links, 1 Feldspieler links, 2 Torwart rechts, 3 Feldspieler rechts, 4 Schiedsrichter, 6 Ball.
  - Fehlende Werte sind `-1`. `x` und `y` liegen in 0–1.
  - Ein Spiel mit rund 69 Minuten Spielzeit braucht etwa 138 Abrufe und rund 7 MB.
- **Folge für den Abgleich:**
  - Positionsdaten werden **einmal je Spiel** geholt, nicht im 14-Tage-Fenster wiederholt.
  - Sie werden **roh je Spielfeldseite** gespeichert (Kategorie links/rechts), verdichtet auf 1 Hz.
  - Die Zuordnung zu eigener Mannschaft und Gegner geschieht erst beim Lesen, mit den aktuellen Halbzeiten. So bleibt eine spätere Seitenkorrektur in Veo ohne Neuladen richtig.
  - Zwischen den Fensterabrufen liegt eine kurze Pause, damit Veo nicht belastet wird.
- **Spieler-Matrizen:**
  - 60 × 30 Zellen, Felder `direction_of_play` (beobachtet `leftToRight`), `peak_value`, `smoothing` 1,5.
  - Je Spieler normiert: Der Höchstwert ist immer 255.
  - `average_position` hat `x`/`z` in 0–1.
  - Für den Zeitausschnitt einer Halbzeit sind `start_time`/`end_time` Pflicht. Für das ganze Spiel gilt das Fenster vom ersten Halbzeitbeginn bis zum letzten Halbzeitende.
  - Weil je Spieler normiert wird, ist die gewichtete Saisonsumme nur eine Näherung (siehe `scope.md`, ⚠️).

**Fallback**, falls ein Spiel ohne Positionsdaten kommt: Der Schieber für den Zeitabschnitt entfällt für dieses Spiel. Wählbar sind dann nur ganze Halbzeiten, aus Veo-Matrizen. Die Mannschafts-Heatmap wird als Summe der Spieler-Matrizen der Halbzeit gezeigt.

## R-06 Koordinaten

**Decision**: Orte werden beim Schreiben normiert gespeichert:
- `x` ∈ [0, 1] entlang der Spielfeldlänge. Jede Mannschaft greift Richtung `x = 1` an, auch der Gegner.
- `y` ∈ [0, 1] über die Breite.
- Gespiegelt wird je Halbzeit nach `own_side`, wie im Veo-Panel (`analysisSlice` `wt`).
- Die Darstellung bildet das auf das jeweilige Spielfeld ab: volles Feld 234 × 150 wie Veo, Halbfeld für Spieler-Schusskarten, Querformat 627 × 402 für den Spielbericht.

**Rationale**: Einheitliche Richtung ist die Voraussetzung für Saisonkarten und für die Gleichheit mit Veo (FR-003). Wird beim Schreiben normiert, muss keine Lesefunktion Halbzeiten kennen.

**Alternatives considered**: Rohwerte speichern und beim Lesen spiegeln. Abgelehnt, weil jede Lesestelle die Halbzeitlogik wiederholen müsste.

**Belegt**:
- MES-`x` lag zwischen 0,11 und 0,99, `z` zwischen −0,0016 und 1,04. Veo liefert also Werte knapp außerhalb von 0–1. Der Worker begrenzt beim Normieren auf [0, 1], wie Veo beim Zeichnen (`clamp`). Die Check-Constraints bleiben streng.
- RAS `shot-details` liefert `location: [x, y]` in 0–1 je Kamera-Seite (`side`), die Namen sind `kick_shot_goal` und `kick_shot_no_goal`. Gebraucht wird es nur als Gegenprobe, weil `match-events` dieselben Schüsse mit Spieler liefert.
- `player-event-maps` liefert `direction_of_play` und `x`/`z` je Ereignis. Der Abgleich der Spiegelung gegen diese Quelle wird in `veoPitch.test.ts` mit den Testdaten festgehalten (T009).

## R-07 Spielerwerte vollständig und je Halbzeit

**Decision**:
- `fetchPlayerStats` wechselt auf `type: match_all_players`. Der Abruf liefert Werte je Halbzeit und die Spieleridentität (`identified` / `jersey_only`).
- `CURATED_PLAYER_STATS` wird auf alle Stat-Typen aus Inventar §4.2.1 erweitert, mit Kategorien (Allgemein, Physis, Angriff, Verteilung, Verteidigung, Standards, Torwart).
- `playerboard_veo_player_stats` bekommt `period_values`.
- Die Zuordnung zum Kader bleibt über die Rückennummer (Paket 053).

**Rationale**: FR-020, Werte je Halbzeit im Spielbericht. `cross_match` mit einem Spiel liefert keine Halbzeiten.

**Belegt**:
- `periods: [{ period: 1, value }, { period: 2, value }]` mit Halbzeitnummer. Werte, die je Spiel gelten (`matches_total`, `starts_total`), haben `periods: []`.
- Spielerwerte: 28 Typen, darunter `football_assist_total`, `football_passes_total`, `football_passes_completed_total`, `football_passes_unsuccessful_total`, `player_of_the_match_total` und `captaincies_total`.
- Mannschaftswerte: 15 Typen.
- Quoten (`football_conversion_rate`, `football_passes_success_rate`) kommen nur in den Ranglisten und werden sonst nach R-08 abgeleitet.

## R-08 Kennzahlen und Ableitungen als Domain-Logik

**Decision**: Alle Ableitungen kommen als reine Funktionen nach `packages/domain` und werden dort mit Vitest getestet:
- Abschlüsse, verfehlte Schüsse, Treffer- und Passquoten
- Anteile je Drittel
- Passketten-Buckets
- Spielverlauf-Anteile
- Saisondurchschnitte und Siegquote
- Ranglisten, Radar-Normierung
- Kacheln je Position

Die Regeln folgen Inventar §1a.2–3, §1b.3, §2.3 und §4.2.1, mit denselben Rundungen wie Veo.

**Rationale**: Die Gleichheit mit Veo (FR-002) hängt an diesen Regeln. Als reine Funktionen sind sie ohne Datenbank testbar, mit den Antworten aus dem Testabruf als Testdaten. Auch der Worker nutzt sie, für das Spiegeln der Koordinaten.

**Alternatives considered**: Ableitungen in SQL. Abgelehnt, weil die Rundungsregeln dann in SQL und für die Anzeige doppelt existierten. Bestehende Ableitungen in `apps/web/app/utils/playerboardVeo.ts` wandern mit, wo sie dieselbe Regel sind. Dabei werden zwei falsche Bezeichnungen korrigiert: `football_loose_total` ist „Ballgewinn (loser Ball)“, nicht „Zweikämpfe“, und `football_interception_total` ist „Abfangen“.

## R-09 Kennzahlenauswahl, Radar und persönliche Einstellungen

**Decision**:
- **Je Mannschaft** (Kennzahlen bis 4, Radar mit 6 Kennzahlen, Vergleichsmannschaft und Zeiträumen): neue Tabelle `playerboard_veo_team_views`. Lesen darf, wer die Werte der Mannschaft sieht. Schreiben erfordert `training.manage`, wie die Zuordnung der Rückennummern. Ohne Zeile gelten Veos Standards.
- **Je Person** (Spalten der Tabellen, Ranglisten-Kennzahlen, Vergleichsspieler): `localStorage`, wie bei Veo.

**Rationale**: FR-031, FR-034. Persönliche Einstellungen sind Bequemlichkeit je Gerät. Veo hält sie selbst nur im Browser, und eine Tabelle dafür wäre Aufwand ohne Nutzen.

**Alternatives considered**: Felder in `playerboard_settings`. Abgelehnt: Das ist die vererbte Richtlinienkette (Verein → Abteilung → Mannschaft), Kennzahlen gelten aber nur je Mannschaft.

## R-10 Spielbericht

**Decision**: Wenn der Analysestand `match-report` meldet, wird `match-report/` beim Abgleich mitgeholt und als JSON gespeichert. Ohne `videos` und ohne Coach Assist, mit Spielern nur als Rückennummer. Namen kommen beim Lesen über die Zuordnung. Für den Vergleich mit den letzten Spielen nutzen wir Veos `comparison`-Feld unverändert (1:1). Passrichtung, Passorte in 9 Zonen, Geschwindigkeitszonen und Abschlüsse im und außerhalb des Strafraums kommen nur aus dem Bericht.

**Rationale**: FR-050–056. Der Bericht ist Veos eigene Zusammenstellung; ihn nachzurechnen wäre fehleranfällig.

**Belegt**:
- Der Bericht kommt für alle drei C1-Spiele, mit `view: advanced`, rund 72 KB.
- Schlüssel: `match`, `club`, `teams`, `lineup`, `score`, `events`, `players`, `scorers`, `periods`, `view`, `overview`, `attacking`, `defensive`, `physical`, `passing`.
- `passing` enthält zusätzlich zum Inventar `forward_accuracy`, `sideways_accuracy`, `backward_accuracy`, `final_third_passes`, `successful_final_third_passes`, `final_third_accuracy` und `pass_string_average_length`.
- `physical.speed_zones.status` ist `available`.
- StatValue hat die Form `{ full_time: { own, opponent }, periods: [{ period_number, own, opponent }], comparison: { full_time: { difference, match_count } } }`.

## R-11 Links ins Veo-Video

**Decision**: `playerboard_veo_matches` speichert zusätzlich den Veo-Spiel-Slug. Ein Link öffnet `https://app.veo.co/matches/{slug}/#t=mm:ss`, wobei `t` die Videozeit minus 3 s ist, wie Veos „Full recording“. Der Link öffnet in einem neuen Tab.

**Rationale**: FR-068, Antwort A auf Q1.

## R-12 Hosts

**Decision**: `VEO_HOSTS` wird um den RAS-Host `dt3kfuz4eo879.cloudfront.net` erweitert. Den Host liefert die Veo-Seite in `window.VEO_SERVICE_URLS.RAS_URL`. Als Konstante bekommt er einen `ponytail:`-Kommentar: Ändert Veo den Host, endet der Abruf mit `upstream_changed`; der Weg zur Verbesserung ist, `RAS_URL` aus `app.veo.co` zu lesen.

**Belegt**: RAS wird **ohne** `Authorization`-Header aufgerufen. Mit Bearer-Token antwortet `…/analytics` mit `403` (CloudFront deutet den Header als eigene Signatur). Ohne Header antworten `analytics`, `shot-details` und `match-details` mit `200`. Der RAS-Status meldet die Schlüssel `ball-tracking`, `player-tracking`, `event-detection`, `match-details`, `shot-details` und `match-report`, jeweils `completed`. Daraus ergibt sich die Analyseversion `2`.

## R-13 Sichtbarkeit und Isolation

**Decision**:
- Jede neue Tabelle hat `organization_id`, zusammengesetzte Fremdschlüssel auf `playerboard_veo_matches` und RLS mit `authz.can_view_playerboard_stats(team_id)` (FR-062).
- Lesefunktionen sind `security definer` mit derselben Prüfung vorab, wie `playerboard_veo_team_matches`.
- Gegnerereignisse speichern nur `team_association = 'opponent'` und eine Rückennummer, nie einen Bezug zum Kader (FR-064).
- `playerboard_public_veo_stats` bleibt unverändert und liest keine neue Tabelle (FR-065).

**Rationale**: AGENTS.md (RLS, positive und negative Isolationstests, keine Cross-Tenant-Referenzen) und die Betreiberentscheidung zu `stats_visibility`.

## R-14 Darstellung ohne neue Abhängigkeit

**Decision**: Die Grafiken sind Vue-Komponenten mit handgeschriebenem SVG, wie in `pages/auswertung.vue`. Heatmaps zeichnet ein `<canvas>` unter dem SVG-Spielfeld. Der Spielverlauf nutzt einen geglätteten SVG-Pfad statt d3. Jede Grafik hat eine Textalternative mit den Kernzahlen. Markierungen unterscheiden sich durch Form, nicht nur durch Farbe (FR-067), wie bei Veo: Raute, Dreieck, Sechseck, Quadrat.

**Rationale**: Die Constitution sagt: keine neue Abhängigkeit, wenn vermeidbar. Eine Chart-Bibliothek brächte für Spielfeldgrafiken wenig, denn die eigentliche Arbeit sind Koordinaten und Zonen.

**Alternatives considered**: d3 oder eine Chart-Bibliothek, abgelehnt aus dem genannten Grund.

## R-15 Speicherbedarf

Für eine Saison mit 40 Spielen und 25 Spielern, Größen je Spiel aus dem Testabruf:

| Daten | je Spiel | Saison |
|---|---|---|
| Ereignisse ohne `possession`/`*_target` | ~800 Zeilen | ~32.000 Zeilen |
| Spieler-Matrizen (60 × 30 uint8, 3 Ausschnitte) | ~45 × 1,8 KB ≈ 80 KB | ~3 MB |
| Positionsdaten (1 Hz, ~22 Spuren à ~4.100 s, 2 × uint16) | ~0,4 MB | ~16 MB |
| übrige Analyse inkl. Bericht (JSON) | ~100 KB | ~4 MB |

Das ist unkritisch für die selbst gehostete Supabase. Der erste Abgleich der C1 mit 8 Spielen braucht wegen der Positionsdaten etwa 1.100 Abrufe bei Veo, danach je neuem Spiel etwa 150.

## R-16 Datenschutz

Heatmaps und Positionsdaten sind Bewegungsprofile, auch von Minderjährigen. Die Sichtbarkeit bleibt nach Betreiberentscheidung bei `stats_visibility`. Positionsdaten verlassen die API nur für ein einzelnes Spiel, nie als Saisonexport. Die Verarbeitungsdokumentation (Paket 020) bekommt den Zweck „Spielanalyse mit Positionsdaten“ (Aufgabe im letzten PR). Logs enthalten nur Zähler und HTTP-Status, keine Inhalte.

## Testabruf: Prüfliste

Ausgeführt am 2026-10-21. Alle Punkte sind oben unter **Belegt** beantwortet. Die Rohantworten bleiben lokal. Anonymisierte Ausschnitte werden Testdaten unter `packages/veo-client/src/__fixtures__/` (T004):

1. Spiel, Slug, `recordings[0].identifier`, Analysestand, Analyseversion
2. Halbzeiten: Schlüssel, `own_side`, Zeitbasis
3. `match-events`: Typen inkl. Pass, `x`/`z`, `period`, `outcome`, Attribute (Vorlage)
4. `player-heatmaps`: `width`/`height`, Zeilenrichtung, Normierung, `direction_of_play`
5. `player-tracking`: verfügbar? Rate, Fensterlänge, Kategorien
6. RAS `match-details` und `shot-details`: Auth, Felder, Einheiten
7. `match-momentum`, `passing-network`: Tupel und Wertebereich
8. `match-report`: verfügbar, `view`, Felder
9. `analysis/stats` `match_all_players`: Periodenschlüssel, alle Stat-Typen
10. Änderungsmerkmal für R-03
