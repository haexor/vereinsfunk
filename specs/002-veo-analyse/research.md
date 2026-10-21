# Research: Veo-Analyse im PlayerBoard

Stand 2026-10-21, gegen `main` `cc7b95c`. Grundlage ist das Inventar der Veo-Web-App in [veo-ui-inventory.md](veo-ui-inventory.md). Es wurde aus den öffentlich ausgelieferten Programmdateien von `app.veo.co` abgeleitet (498 Chunks, Sentry-Release `24036065…`). Die Dateien wurden nur gelesen, nie ausgeführt.

Punkte mit **[Testabruf]** stützen sich bisher nur auf den Code der Veo-App. Sie werden mit dem lesenden Testabruf gegen das Veo-Konto der C1 belegt (Aufgabe 1 in `tasks.md`). Weicht das Ergebnis ab, wird dieser Abschnitt angepasst, bevor PR 1 gemergt wird.

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

**[Testabruf]**: ob `match-events` Pässe enthält (Schalter `player-passes-events-panel`); Wertebereich und Ursprung von `x`/`z`; Schlüssel von `byPeriod`.

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

**Rationale**: Je Spiel kommen etwa 12 bis 14 Abrufe dazu, Tracking nicht mitgezählt. Bei 40 Spielen und täglichem Lauf wären das sonst über 500 Abrufe täglich gegen eine inoffizielle API. Korrekturen in Veo passieren erfahrungsgemäß in den Tagen nach dem Spiel.

**Alternatives considered**:
- Ein Änderungsmerkmal aus Veo auswerten: Unbelegt, ob Veo Halbzeit- oder Ereignisänderungen in einem Zeitstempel ausweist **[Testabruf]**. Gibt es einen, ersetzt er die 14-Tage-Regel.
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

**[Testabruf]**:
- Ist `player-tracking` mit dem Abo der C1 verfügbar, und mit welcher Abtastrate?
- Zeilenrichtung der Matrix, und gilt `direction_of_play` je Abruf?
- Sind Matrixwerte je Spieler normiert?

**Fallback**, falls Tracking nicht verfügbar ist: Der Schieber für den Zeitabschnitt entfällt. Wählbar sind dann nur ganze Halbzeiten, aus Veo-Matrizen. Die Mannschafts-Heatmap wird als Summe der Spieler-Matrizen der Halbzeit gezeigt. Die Abweichung wird im Umfangsverzeichnis vermerkt.

## R-06 Koordinaten

**Decision**: Orte werden beim Schreiben normiert gespeichert:
- `x` ∈ [0, 1] entlang der Spielfeldlänge. Jede Mannschaft greift Richtung `x = 1` an, auch der Gegner.
- `y` ∈ [0, 1] über die Breite.
- Gespiegelt wird je Halbzeit nach `own_side`, wie im Veo-Panel (`analysisSlice` `wt`).
- Die Darstellung bildet das auf das jeweilige Spielfeld ab: volles Feld 234 × 150 wie Veo, Halbfeld für Spieler-Schusskarten, Querformat 627 × 402 für den Spielbericht.

**Rationale**: Einheitliche Richtung ist die Voraussetzung für Saisonkarten und für die Gleichheit mit Veo (FR-003). Wird beim Schreiben normiert, muss keine Lesefunktion Halbzeiten kennen.

**Alternatives considered**: Rohwerte speichern und beim Lesen spiegeln. Abgelehnt, weil jede Lesestelle die Halbzeitlogik wiederholen müsste.

**[Testabruf]**: Ursprung und Achsen von MES `x`/`z`. Gegenprobe mit `player-event-maps` (`direction_of_play`) und RAS `shot-details` am selben Spiel.

## R-07 Spielerwerte vollständig und je Halbzeit

**Decision**:
- `fetchPlayerStats` wechselt auf `type: match_all_players`. Der Abruf liefert Werte je Halbzeit und die Spieleridentität (`identified` / `jersey_only`).
- `CURATED_PLAYER_STATS` wird auf alle Stat-Typen aus Inventar §4.2.1 erweitert, mit Kategorien (Allgemein, Physis, Angriff, Verteilung, Verteidigung, Standards, Torwart).
- `playerboard_veo_player_stats` bekommt `period_values`.
- Die Zuordnung zum Kader bleibt über die Rückennummer (Paket 053).

**Rationale**: FR-020, Werte je Halbzeit im Spielbericht. `cross_match` mit einem Spiel liefert keine Halbzeiten.

**[Testabruf]**: Form von `periods[].period` (Nummer oder ID).

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

**[Testabruf]**: Liefert Veo den Bericht für die C1 (Abo, Stichtag 2026-08-04), und in welcher `view` (Basis oder erweitert)?

## R-11 Links ins Veo-Video

**Decision**: `playerboard_veo_matches` speichert zusätzlich den Veo-Spiel-Slug. Ein Link öffnet `https://app.veo.co/matches/{slug}/#t=mm:ss`, wobei `t` die Videozeit minus 3 s ist, wie Veos „Full recording“. Der Link öffnet in einem neuen Tab.

**Rationale**: FR-068, Antwort A auf Q1.

## R-12 Hosts

**Decision**: `VEO_HOSTS` wird um den RAS-Host `dt3kfuz4eo879.cloudfront.net` erweitert. Den Host liefert die Veo-Seite in `window.VEO_SERVICE_URLS.RAS_URL`. Als Konstante bekommt er einen `ponytail:`-Kommentar: Ändert Veo den Host, endet der Abruf mit `upstream_changed`; der Weg zur Verbesserung ist, `RAS_URL` aus `app.veo.co` zu lesen.

**[Testabruf]**: Braucht RAS das Bearer-Token? Veo ruft es mit `credentials: "omit"` auf.

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

Für eine Saison mit 40 Spielen und 25 Spielern (Schätzung, Tracking **[Testabruf]**):

| Daten | je Spiel | Saison |
|---|---|---|
| Ereignisse (inkl. Pässe, falls geliefert) | ~1.500 Zeilen | ~60.000 Zeilen |
| Spieler-Matrizen (60 × 30 uint8, 3 Ausschnitte) | ~45 × 1,8 KB ≈ 80 KB | ~3 MB |
| Positionsdaten (1 Hz, ~25 Spuren, 2 × uint16) | ~0,5 MB | ~20 MB |
| übrige Analyse (JSON) | ~30 KB | ~1,2 MB |

Das ist unkritisch für die selbst gehostete Supabase. Bei den Positionsdaten wird die Rate im Testabruf festgelegt.

## R-16 Datenschutz

Heatmaps und Positionsdaten sind Bewegungsprofile, auch von Minderjährigen. Die Sichtbarkeit bleibt nach Betreiberentscheidung bei `stats_visibility`. Positionsdaten verlassen die API nur für ein einzelnes Spiel, nie als Saisonexport. Die Verarbeitungsdokumentation (Paket 020) bekommt den Zweck „Spielanalyse mit Positionsdaten“ (Aufgabe im letzten PR). Logs enthalten nur Zähler und HTTP-Status, keine Inhalte.

## Testabruf: Prüfliste

Wird mit dem Testskript aus der Recherche ausgeführt. Rohantworten bleiben lokal; anonymisierte Ausschnitte werden Testdaten unter `packages/veo-client/src/__fixtures__/`:

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
